import "server-only";

import type { CrmSupabaseClient } from "@/lib/supabase/server";
import { RepositoryError } from "@/lib/crm/objects/errors";
import type { CrmObject, EntityLink, RecordRow } from "@/lib/crm/objects/types";
import { leadSlaHandler } from "@/lib/crm/leads/sla-virtual";
import { dueRangeBounds } from "@/lib/crm/activities/due";
import { stageKindsFromRows } from "@/lib/crm/opportunities/stages";
import { fetchInChunks } from "./chunk";
import { getStages } from "./lookups";

/**
 * Handlers for `virtual: true` fields (values that live in another table).
 * Keyed by `${object}.${fieldKey}`. All use the caller's user-scoped client.
 */
export interface VirtualFieldHandler {
  /**
   * Values per record id (missing ids = empty). `rows` are the loaded rows;
   * handlers that compute from columns read them instead of re-querying
   * (declare those columns in `columns`).
   */
  load(client: CrmSupabaseClient, ids: string[], rows: RecordRow[]): Promise<Map<string, unknown>>;
  /** Table columns `load` reads from `rows` (added to partial selects such as related lists). */
  columns?: string[];
  /** Replaces the value of one record. Runs after the record insert/update. */
  save(client: CrmSupabaseClient, recordId: string, value: unknown): Promise<void>;
  /**
   * Optional atomic create: inserts the record together with this value in
   * one call and returns the new id (no partial create). Used by create()
   * when the value is non-empty.
   */
  createWith?(
    client: CrmSupabaseClient,
    columns: Record<string, unknown>,
    value: unknown
  ): Promise<string | null>;
  /**
   * List filter as a PostgREST inner embed: `select` is appended to the list
   * select and `column` gets `in (values)`. Parents are not duplicated.
   */
  filter?: { select: string; column: string };
  /** List filter applied directly to the query (for filter-only virtual fields). */
  applyFilter?: <B extends FilterBuilder>(builder: B, values: string[]) => B;
}

/** The PostgREST filter methods a virtual `applyFilter` may use. */
export interface FilterBuilder {
  eq(column: string, value: string): this;
  gte(column: string, value: string): this;
  lt(column: string, value: string): this;
  is(column: string, value: null): this;
}

/** activity.due_range: filter-only (no value), rolling bounds from due.ts. */
const activityDueRange: VirtualFieldHandler = {
  async load() {
    return new Map();
  },
  async save() {},
  applyFilter(builder, values) {
    const bounds = dueRangeBounds(values[0] ?? "", new Date());
    if (!bounds) return builder;
    if (bounds.none) return builder.is("due_at", null);
    let next = builder;
    if (bounds.status) next = next.eq("status", bounds.status);
    if (bounds.from) next = next.gte("due_at", bounds.from);
    if (bounds.to) next = next.lt("due_at", bounds.to);
    return next;
  },
};

type AccountEntityRow = { account_id: string; entity_id: string; is_primary: boolean };

const linksPayload = (value: unknown) =>
  ((value as EntityLink[] | undefined) ?? []).map((l) => ({ entity_id: l.entityId, is_primary: l.isPrimary }));

/** crm_account_entities: account <-> group company, exactly one primary when linked. */
const accountEntities: VirtualFieldHandler = {
  async load(client, ids) {
    const out = new Map<string, unknown>();
    const rows = await fetchInChunks(ids, async (part) => {
      const { data, error } = await client
        .from("crm_account_entities")
        .select("account_id, entity_id, is_primary")
        .in("account_id", part);
      if (error) throw new RepositoryError(error, "account entities load");
      return (data ?? []) as AccountEntityRow[];
    });
    for (const row of rows) {
      const list = (out.get(row.account_id) as EntityLink[] | undefined) ?? [];
      list.push({ entityId: row.entity_id, isPrimary: row.is_primary });
      out.set(row.account_id, list);
    }
    for (const list of out.values()) {
      (list as EntityLink[]).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
    }
    return out;
  },

  /** Replaces all links in one transaction (P0001 `one_primary_required`). */
  async save(client, accountId, value) {
    const { error } = await client.rpc("crm_set_account_entities", {
      p_account_id: accountId,
      p_links: linksPayload(value),
    });
    if (error) throw new RepositoryError(error, "account entities save");
  },

  /** Account insert + links in one transaction (crm_create_account). */
  async createWith(client, columns, value) {
    const { data, error } = await client.rpc("crm_create_account", {
      p_account: columns,
      p_links: linksPayload(value),
    });
    if (error) throw new RepositoryError(error, "account create");
    return returnedId(data);
  },

  filter: {
    select: "_entity_filter:crm_account_entities!inner(entity_id)",
    column: "_entity_filter.entity_id",
  },
};

/** Id from an RPC jsonb result: a bare id or an object with `id`. */
export function returnedId(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (data && typeof data === "object" && typeof (data as { id?: unknown }).id === "string") {
    return (data as { id: string }).id;
  }
  return null;
}

/** Read-only: the primary group company of an account (record highlights). */
const accountPrimaryEntity: VirtualFieldHandler = {
  async load(client, ids) {
    const out = new Map<string, unknown>();
    const rows = await fetchInChunks(ids, async (part) => {
      const { data, error } = await client
        .from("crm_account_entities")
        .select("account_id, entity_id")
        .in("account_id", part)
        .eq("is_primary", true);
      if (error) throw new RepositoryError(error, "account primary entity load");
      return (data ?? []) as Array<{ account_id: string; entity_id: string }>;
    });
    for (const row of rows) out.set(row.account_id, row.entity_id);
    return out;
  },
  async save() {
    // Derived from `entities`; never written directly (field is editable: false).
  },
};

/**
 * Read-only: open / won / lost from the opportunity's stage (list filter
 * "status"). Computed from the rows' stage_id and the cached active stages;
 * only stages outside that list (inactive ones) are read, chunked.
 */
const opportunityStageKind: VirtualFieldHandler = {
  columns: ["stage_id"],
  async load(client, _ids, rows) {
    const kinds = new Map<string, string>((await getStages(client)).map((s) => [s.value, s.kind]));
    const missing = rows
      .map((r) => r.stage_id)
      .filter((id): id is string => typeof id === "string" && !kinds.has(id));
    const extra = await fetchInChunks(missing, async (part) => {
      const { data, error } = await client.from("crm_pipeline_stages").select("id, kind").in("id", part);
      if (error) throw new RepositoryError(error, "opportunity stage kind load");
      return (data ?? []) as Array<{ id: string; kind: string }>;
    });
    for (const s of extra) kinds.set(s.id, s.kind);
    return stageKindsFromRows(rows, kinds);
  },
  async save() {
    // Derived from stage_id; never written (field is editable: false).
  },
  filter: {
    select: "_stage_kind_filter:crm_pipeline_stages!inner(kind)",
    column: "_stage_kind_filter.kind",
  },
};

const handlers: Record<string, VirtualFieldHandler> = {
  "lead.sla": leadSlaHandler,
  "opportunity.stage_kind": opportunityStageKind,
  "account.entities": accountEntities,
  "activity.due_range": activityDueRange,
  "account.primary_entity": accountPrimaryEntity,
};

export function getVirtualHandler(object: CrmObject, key: string): VirtualFieldHandler | null {
  return handlers[`${object}.${key}`] ?? null;
}
