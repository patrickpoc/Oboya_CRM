import "server-only";

import type { CrmSupabaseClient } from "@/lib/supabase/server";
import { toCsv } from "@/lib/crm/csv";
import { RepositoryError } from "@/lib/crm/objects/errors";
import {
  EXPORT_LIMIT,
  buildSearchFilter,
  getField,
  parseDateRange,
  recordName,
  selectColumns,
} from "@/lib/crm/objects/query";
import { getRecordConfig } from "@/lib/crm/objects/registry";
import {
  OBJECT_META,
  lookupTarget,
  type CrmObject,
  type EntityLink,
  type FieldConfig,
  type ListQuery,
  type RecordConfig,
  type RecordRow,
  type RelatedListData,
} from "@/lib/crm/objects/types";
import { addDays } from "@/lib/crm/activities/due";
import { zonedMidnight } from "@/lib/crm/dashboard/time";
import { fetchInChunks } from "./chunk";
import { getEntities, getPicklists, getStages, getUsers } from "./lookups";
import { getVirtualHandler } from "./virtual-fields";

/**
 * Generic data access for every object in the registry. Always called with the
 * user-scoped client (requireCrmAuth / crmGuard): RLS decides visibility, the
 * row guard and audit triggers run as the user. Never the service role.
 */

export type RepoContext = { userId: string };
export type ListResult = { rows: RecordRow[]; total: number };

const RECENT_LIMIT = 100;
/** PostgREST max-rows on Supabase defaults to 1000; export pages through it. */
const FETCH_CHUNK = 1000;

function fail(error: { code?: string; message?: string }, context: string): never {
  throw new RepositoryError(error, context);
}

// ---------------------------------------------------------------------------
// Display labels for references (owner, lookups, entities, picklists, stages)
// ---------------------------------------------------------------------------

/** `only` restricts the loaded virtual fields (reports load just the ones they use). */
export async function attachVirtual(
  client: CrmSupabaseClient,
  config: RecordConfig,
  rows: RecordRow[],
  only?: ReadonlySet<string>
) {
  const ids = rows.map((r) => r.id);
  for (const field of config.fields.filter((f) => f.virtual && (!only || only.has(f.key)))) {
    const handler = getVirtualHandler(config.object, field.key);
    if (!handler) continue;
    const values = await handler.load(client, ids, rows);
    for (const row of rows) row[field.key] = values.get(row.id) ?? (field.multiple ? [] : null);
  }
}

export async function attachDisplay(client: CrmSupabaseClient, config: RecordConfig, rows: RecordRow[]) {
  if (rows.length === 0) return;
  const [users, entities, picklists, stages] = await Promise.all([
    getUsers(client),
    getEntities(client),
    getPicklists(client),
    config.path?.source === "stages" ? getStages(client) : Promise.resolve([]),
  ]);
  const userName = new Map(users.map((u) => [u.value, u.label]));
  const entityName = new Map(entities.map((e) => [e.value, e.label]));
  const stageName = new Map(stages.map((s) => [s.value, s.label]));

  // Lookup targets: one query per target object, RLS-scoped (invisible = no label).
  const lookupLabels = new Map<CrmObject, Map<string, string>>();
  const lookupFields = config.fields.filter((f) => f.type === "lookup" && (f.lookup || f.lookupFrom));
  const idsByTarget = new Map<CrmObject, Set<string>>();
  for (const field of lookupFields) {
    for (const row of rows) {
      const v = row[field.key];
      const target = lookupTarget(field, row);
      if (typeof v === "string" && target) {
        const set = idsByTarget.get(target) ?? new Set<string>();
        set.add(v);
        idsByTarget.set(target, set);
      }
    }
  }
  await Promise.all(
    [...idsByTarget].map(async ([target, ids]) => {
      const meta = OBJECT_META[target];
      const data = await fetchInChunks(ids, async (part) => {
        const res = await client
          .from(meta.table)
          .select(`id, ${meta.nameColumn}`)
          .in("id", part)
          .is("deleted_at", null);
        if (res.error) fail(res.error, `lookup labels ${target}`);
        return (res.data ?? []) as unknown as Array<Record<string, string>>;
      });
      lookupLabels.set(target, new Map(data.map((r) => [r.id, r[meta.nameColumn] ?? ""])));
    })
  );

  const optionLabel = (field: FieldConfig, value: string) =>
    field.picklist?.kind === "picklist"
      ? picklists[field.picklist.picklist]?.find((o) => o.value === value)?.label
      : undefined;

  for (const row of rows) {
    const display: Record<string, string> = {};
    for (const field of config.fields) {
      const value = row[field.key];
      if (value == null) continue;
      let label: string | undefined;
      if (field.type === "owner" && typeof value === "string") label = userName.get(value);
      else if (field.type === "lookup" && typeof value === "string") {
        const target = lookupTarget(field, row);
        label = target ? lookupLabels.get(target)?.get(value) : undefined;
      }
      else if (field.type === "entity" && typeof value === "string") label = entityName.get(value);
      else if (field.type === "entity" && Array.isArray(value)) {
        label = (value as EntityLink[]).map((l) => entityName.get(l.entityId) ?? "").filter(Boolean).join(", ");
      } else if (field.type === "picklist" && typeof value === "string") label = optionLabel(field, value);
      else if (field.type === "multipicklist" && Array.isArray(value)) {
        label = (value as string[]).map((v) => optionLabel(field, v) ?? v).join(", ");
      }
      if (config.path?.source === "stages" && field.key === config.path.field && typeof value === "string") {
        label = stageName.get(value);
      }
      if (label) display[field.key] = label;
    }
    if (typeof row.owner_id === "string" && !display.owner_id) {
      const owner = userName.get(row.owner_id);
      if (owner) display.owner_id = owner;
    }
    display._name = recordName(config, row);
    row._display = display;
  }
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

async function recentIds(client: CrmSupabaseClient, config: RecordConfig, ctx: RepoContext) {
  const { data, error } = await client
    .from("crm_recent_views")
    .select("record_id")
    .eq("user_id", ctx.userId)
    .eq("object", config.object)
    .order("viewed_at", { ascending: false })
    .limit(RECENT_LIMIT);
  if (error) fail(error, "recent views");
  return ((data ?? []) as Array<{ record_id: string }>).map((r) => r.record_id);
}

export type BaseQueryOptions = {
  /** Replaces the default column list (filter embeds are still added). */
  select?: string;
  /** Datetime range filters cover whole days of this IANA zone instead of UTC days. */
  timeZone?: string;
  /** false skips the exact count (default: exact). */
  count?: boolean;
};

export function baseQuery(
  client: CrmSupabaseClient,
  config: RecordConfig,
  query: ListQuery,
  ctx: RepoContext,
  restrictIds: string[] | null,
  options: BaseQueryOptions = {}
) {
  const embeds: Array<{ column: string; values: string[] }> = [];
  const selects = [options.select ?? selectColumns(config)];
  for (const [key, values] of Object.entries(query.filters)) {
    const field = getField(config, key);
    const filter = field?.virtual ? getVirtualHandler(config.object, key)?.filter : undefined;
    if (filter && values.length > 0) {
      selects.push(filter.select);
      embeds.push({ column: filter.column, values });
    }
  }
  let builder = client
    .from(config.table)
    .select(selects.join(","), options.count === false ? undefined : { count: "exact" })
    .is("deleted_at", null);
  for (const embed of embeds) builder = builder.in(embed.column, embed.values);
  if (query.view === "mine") builder = builder.eq("owner_id", ctx.userId);
  if (restrictIds) builder = builder.in("id", restrictIds);

  for (const [key, values] of Object.entries(query.filters)) {
    // Keys and values were whitelisted/validated by parseListQuery.
    const field = getField(config, key);
    if (field?.virtual && values.length > 0) {
      const apply = getVirtualHandler(config.object, key)?.applyFilter;
      if (apply) builder = apply(builder, values);
    }
    if (!field || field.virtual || values.length === 0) continue;
    const range = field.type === "date" || field.type === "datetime" ? parseDateRange(values[0]) : null;
    if (range && field.type === "datetime") {
      if (options.timeZone) {
        // Whole days of the viewer's zone: [from 00:00, to + 1 day 00:00).
        if (range.from) builder = builder.gte(key, zonedMidnight(range.from, options.timeZone).toISOString());
        if (range.to) builder = builder.lt(key, zonedMidnight(addDays(range.to, 1), options.timeZone).toISOString());
      } else {
        // Whole UTC days: [from 00:00, to + 1 day).
        if (range.from) builder = builder.gte(key, `${range.from}T00:00:00Z`);
        if (range.to) builder = builder.lt(key, new Date(Date.parse(`${range.to}T00:00:00Z`) + 864e5).toISOString());
      }
    } else if (range) {
      if (range.from) builder = builder.gte(key, range.from);
      if (range.to) builder = builder.lte(key, range.to);
    } else if (field.type === "boolean") builder = builder.eq(key, values[0] === "true");
    else if (field.type === "multipicklist" || field.type === "tags") builder = builder.overlaps(key, values);
    else if (values.length === 1) builder = builder.eq(key, values[0]);
    else builder = builder.in(key, values);
  }

  const search = buildSearchFilter(config, query.q);
  if (search) builder = builder.or(search);
  return builder;
}

/** Removes filter-only embeds (keys starting with "_" other than _display). */
export function stripEmbeds(rows: RecordRow[]): RecordRow[] {
  for (const row of rows) {
    for (const key of Object.keys(row)) if (key.startsWith("_") && key !== "_display") delete row[key];
  }
  return rows;
}

async function fetchRows(
  client: CrmSupabaseClient,
  config: RecordConfig,
  query: ListQuery,
  ctx: RepoContext,
  limit?: number
): Promise<ListResult> {
  let restrict: string[] | null = null;
  if (query.view === "recent") {
    restrict = await recentIds(client, config, ctx);
    if (restrict.length === 0) return { rows: [], total: 0 };
  }

  if (query.view === "recent") {
    // At most RECENT_LIMIT rows: fetch all, keep viewed order, page in memory.
    const { data, error, count } = await baseQuery(client, config, query, ctx, restrict).limit(RECENT_LIMIT);
    if (error) fail(error, "list recent");
    const order = new Map(restrict!.map((id, i) => [id, i]));
    const all = stripEmbeds((data ?? []) as unknown as RecordRow[]).sort(
      (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)
    );
    const from = limit ? 0 : query.page * query.pageSize;
    const size = limit ?? query.pageSize;
    return { rows: all.slice(from, from + size), total: count ?? all.length };
  }

  const wanted = limit ?? query.pageSize;
  const start = limit ? 0 : query.page * query.pageSize;
  const rows: RecordRow[] = [];
  let total = 0;
  for (let offset = 0; offset < wanted; offset += FETCH_CHUNK) {
    const size = Math.min(FETCH_CHUNK, wanted - offset);
    const { data, error, count } = await baseQuery(client, config, query, ctx, restrict)
      .order(query.sort, { ascending: query.dir === "asc", nullsFirst: false })
      .order("id", { ascending: true })
      .range(start + offset, start + offset + size - 1);
    if (error) fail(error, "list");
    total = count ?? 0;
    const chunk = stripEmbeds((data ?? []) as unknown as RecordRow[]);
    rows.push(...chunk);
    if (chunk.length < size) break;
  }
  return { rows, total };
}

export async function list(
  client: CrmSupabaseClient,
  config: RecordConfig,
  query: ListQuery,
  ctx: RepoContext
): Promise<ListResult> {
  const result = await fetchRows(client, config, query, ctx);
  await attachVirtual(client, config, result.rows);
  await attachDisplay(client, config, result.rows);
  return result;
}

// ---------------------------------------------------------------------------
// Single record
// ---------------------------------------------------------------------------

export async function get(
  client: CrmSupabaseClient,
  config: RecordConfig,
  id: string
): Promise<RecordRow | null> {
  const { data, error } = await client
    .from(config.table)
    .select(selectColumns(config))
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) fail(error, "get");
  if (!data) return null;
  const row = data as unknown as RecordRow;
  await attachVirtual(client, config, [row]);
  await attachDisplay(client, config, [row]);
  return row;
}

/** Splits validated input into table columns and virtual values. */
function splitInput(config: RecordConfig, input: Record<string, unknown>) {
  const columns: Record<string, unknown> = {};
  const virtual: Array<[string, unknown]> = [];
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const field = getField(config, key);
    if (!field) continue;
    if (field.virtual) virtual.push([key, value]);
    else columns[key] = value;
  }
  return { columns, virtual };
}

async function saveVirtual(
  client: CrmSupabaseClient,
  config: RecordConfig,
  id: string,
  virtual: Array<[string, unknown]>
) {
  for (const [key, value] of virtual) {
    const handler = getVirtualHandler(config.object, key);
    if (handler) await handler.save(client, id, value);
  }
}

/** `input` must come from buildSchema(config, "create"). */
export async function create(
  client: CrmSupabaseClient,
  config: RecordConfig,
  input: Record<string, unknown>
): Promise<RecordRow> {
  const { columns, virtual } = splitInput(config, input);
  // A virtual value with an atomic create (account + entity links) inserts
  // the record and that value in one call, so a failure leaves nothing behind.
  const atomicIndex = virtual.findIndex(
    ([key, value]) => Boolean(getVirtualHandler(config.object, key)?.createWith) && Array.isArray(value) && value.length > 0
  );
  let id: string;
  if (atomicIndex >= 0) {
    const [key, value] = virtual[atomicIndex];
    const created = await getVirtualHandler(config.object, key)!.createWith!(client, columns, value);
    if (!created) fail({ code: "P0002" }, "create");
    id = created;
    virtual.splice(atomicIndex, 1);
  } else {
    const { data, error } = await client.from(config.table).insert(columns).select("id").single();
    if (error) fail(error, "create");
    id = (data as { id: string }).id;
    // Nothing to link: skip empty atomic-create values (no second write after the insert).
    for (let i = virtual.length - 1; i >= 0; i--) {
      const [key, value] = virtual[i];
      if (getVirtualHandler(config.object, key)?.createWith && Array.isArray(value) && value.length === 0) virtual.splice(i, 1);
    }
  }
  await saveVirtual(client, config, id, virtual);
  const row = await get(client, config, id);
  if (!row) fail({ code: "P0002" }, "create readback");
  return row;
}

/** Partial update; `input` must come from buildSchema(config, "update"). Null when not visible. */
export async function update(
  client: CrmSupabaseClient,
  config: RecordConfig,
  id: string,
  input: Record<string, unknown>
): Promise<RecordRow | null> {
  if (config.beforeUpdate) {
    const current = await client
      .from(config.table)
      .select(selectColumns(config))
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (current.error) fail(current.error, "update rule check");
    if (!current.data) return null;
    const ruled = config.beforeUpdate(current.data as unknown as RecordRow, input, new Date());
    if ("error" in ruled) fail({ code: "P0001", message: ruled.error }, "update rule");
    input = ruled.patch;
  }
  const { columns, virtual } = splitInput(config, input);
  if (Object.keys(columns).length > 0) {
    const { data, error } = await client
      .from(config.table)
      .update(columns)
      .eq("id", id)
      .is("deleted_at", null)
      .select("id");
    if (error) fail(error, "update");
    if (!data || data.length === 0) return null;
  } else {
    const existing = await client.from(config.table).select("id").eq("id", id).is("deleted_at", null).maybeSingle();
    if (existing.error) fail(existing.error, "update check");
    if (!existing.data) return null;
  }
  await saveVirtual(client, config, id, virtual);
  return get(client, config, id);
}

/** Soft delete through the RPC (checks <module>.delete and visibility). */
export async function softDelete(client: CrmSupabaseClient, config: RecordConfig, id: string) {
  const { error } = await client.rpc("crm_soft_delete", { p_object: config.object, p_id: id });
  if (error) fail(error, "soft delete");
}

/** Upserts crm_recent_views for the current user. Never throws (page load must not fail). */
export async function markViewed(
  client: CrmSupabaseClient,
  config: RecordConfig,
  id: string,
  ctx: RepoContext
) {
  const { error } = await client.from("crm_recent_views").upsert(
    { user_id: ctx.userId, object: config.object, record_id: id, viewed_at: new Date().toISOString() },
    { onConflict: "user_id,object,record_id" }
  );
  if (error) console.error("markViewed failed:", error.code);
}

// ---------------------------------------------------------------------------
// Related lists
// ---------------------------------------------------------------------------

const RELATED_PREVIEW = 5;

export async function related(
  client: CrmSupabaseClient,
  config: RecordConfig,
  id: string
): Promise<RelatedListData[]> {
  return Promise.all(
    config.relatedLists.map(async (rel) => {
      const meta = OBJECT_META[rel.object];
      const target = getRecordConfig(rel.object);
      const columns = new Set(["id", "owner_id", meta.nameColumn]);
      for (const c of rel.columns) {
        const field = target ? getField(target, c) : undefined;
        if (!target || (field && !field.virtual)) columns.add(c);
        if (field?.currencyField) columns.add(field.currencyField);
      }
      // Columns computed virtual fields read from the rows (e.g. stage_id for stage_kind).
      for (const field of target?.fields ?? []) {
        if (!field.virtual) continue;
        for (const c of getVirtualHandler(rel.object, field.key)?.columns ?? []) columns.add(c);
      }
      let builder = client
        .from(meta.table)
        .select([...columns].join(","), { count: "exact" })
        .eq(rel.foreignKey, id)
        .is("deleted_at", null);
      for (const [key, value] of Object.entries(rel.where ?? {})) builder = builder.eq(key, value);
      const { data, error, count } = await builder
        .order("created_at", { ascending: false })
        .limit(RELATED_PREVIEW);
      if (error) fail(error, `related ${rel.key}`);
      const rows = (data ?? []) as unknown as RecordRow[];
      if (target) {
        await attachVirtual(client, target, rows);
        await attachDisplay(client, target, rows);
      } else {
        for (const row of rows) row._display = { _name: String(row[meta.nameColumn] ?? "") };
      }
      return {
        key: rel.key,
        object: rel.object,
        labelKey: rel.labelKey,
        foreignKey: rel.foreignKey,
        where: rel.where,
        columns: rel.columns,
        rows,
        total: count ?? rows.length,
      };
    })
  );
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

export type Translate = (key: string) => string;

function csvValue(config: RecordConfig, field: FieldConfig, row: RecordRow, t: Translate): unknown {
  const value = row[field.key];
  const display = row._display?.[field.key];
  if (display) return display;
  if (value == null) return "";
  if (field.picklist?.kind === "static" && typeof value === "string") {
    const option = field.picklist.options.find((o) => o.value === value);
    return option ? t(`${config.namespace}.${option.labelKey}`) : value;
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  return value;
}

/** Same filters as the list, capped at EXPORT_LIMIT rows. */
export async function exportCsv(
  client: CrmSupabaseClient,
  config: RecordConfig,
  query: ListQuery,
  ctx: RepoContext,
  t: Translate
): Promise<{ csv: string; rows: number }> {
  const result = await fetchRows(client, config, query, ctx, EXPORT_LIMIT);
  await attachVirtual(client, config, result.rows);
  await attachDisplay(client, config, result.rows);
  const fields = config.fields;
  const header = ["id", ...fields.map((f) => t(`${config.namespace}.${f.labelKey}`))];
  const rows = result.rows.map((row) => [row.id, ...fields.map((f) => csvValue(config, f, row, t))]);
  return { csv: toCsv(header, rows), rows: rows.length };
}
