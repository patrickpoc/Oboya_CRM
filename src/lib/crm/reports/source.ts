import "server-only";

import type { CrmSupabaseClient } from "@/lib/supabase/server";
import { parseFxTable, type FxTable } from "@/lib/crm/dashboard/aggregate";
import { RepositoryError } from "@/lib/crm/objects/errors";
import { getField } from "@/lib/crm/objects/query";
import {
  OBJECT_META,
  lookupTarget,
  type CrmObject,
  type FieldConfig,
  type ListQuery,
  type RecordConfig,
  type RecordRow,
} from "@/lib/crm/objects/types";
import { fetchInChunks } from "@/lib/crm/repositories/chunk";
import { baseQuery, stripEmbeds, type RepoContext } from "@/lib/crm/repositories/object-repository";
import { getVirtualHandler } from "@/lib/crm/repositories/virtual-fields";
import { scanPlan } from "./aggregate";

/** PostgREST max-rows is 1000 per request. */
export const SCAN_CHUNK = 1000;
export const SCAN_PARALLEL = 4;

/** Real columns a report must read for the given field keys (+ what their labels/handlers need). */
export function selectFor(config: RecordConfig, keys: Iterable<string>, extra: string[] = []): string {
  const cols = new Set<string>(["id", ...extra]);
  for (const key of keys) {
    const field = getField(config, key);
    if (!field) continue;
    if (field.virtual) for (const c of getVirtualHandler(config.object, key)?.columns ?? []) cols.add(c);
    else cols.add(key);
    if (field.currencyField) cols.add(field.currencyField);
    if (field.lookupFrom) cols.add(field.lookupFrom);
  }
  return [...cols].join(",");
}

/** Extra columns display names (`_display._name`) need. */
export const nameColumns = (config: RecordConfig) => ["owner_id", ...config.nameFields];

export type ScanOptions = {
  select: string;
  /** Rows to read at most (REPORT_SCAN_CAP for aggregates, `limit` for tabular). */
  wanted: number;
  timeZone: string;
  order?: { field: string; asc: boolean };
};

/**
 * Reads matching rows in chunks of 1000: the first carries the exact count,
 * the rest run up to 4 in parallel. Only the viewer's client, so RLS decides
 * what is visible. `capped` is true when more rows matched than `wanted`.
 */
export async function scanRows(
  client: CrmSupabaseClient,
  config: RecordConfig,
  query: ListQuery,
  ctx: RepoContext,
  opts: ScanOptions
): Promise<{ rows: RecordRow[]; total: number; capped: boolean }> {
  const page = async (offset: number, count: boolean) => {
    let builder = baseQuery(client, config, query, ctx, null, {
      select: opts.select,
      timeZone: opts.timeZone,
      count,
    });
    if (opts.order) builder = builder.order(opts.order.field, { ascending: opts.order.asc, nullsFirst: false });
    const size = Math.min(SCAN_CHUNK, opts.wanted - offset);
    const { data, error, count: total } = await builder.order("id", { ascending: true }).range(offset, offset + size - 1);
    if (error) throw new RepositoryError(error, "report scan");
    return { rows: stripEmbeds((data ?? []) as unknown as RecordRow[]), total: total ?? 0 };
  };

  if (opts.wanted <= 0) return { rows: [], total: 0, capped: false };
  const first = await page(0, true);
  const plan = scanPlan(first.total, opts.wanted, SCAN_CHUNK);
  const rest = plan.offsets.slice(1);
  const parts: RecordRow[][] = [first.rows];
  // Worker pool: at most SCAN_PARALLEL chunks in flight, kept in offset order.
  const results: RecordRow[][] = new Array(rest.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(SCAN_PARALLEL, rest.length) }, async () => {
      while (next < rest.length) {
        const i = next++;
        results[i] = (await page(rest[i], false)).rows;
      }
    })
  );
  parts.push(...results);
  const seen = new Set<string>();
  const rows = parts.flat().filter((r) => !seen.has(r.id) && seen.add(r.id));
  return { rows, total: first.total, capped: plan.truncated };
}

/** crm_settings.fx_rates, parsed (null when absent). */
export async function readFx(client: CrmSupabaseClient): Promise<FxTable | null> {
  const { data, error } = await client.from("crm_settings").select("value").eq("key", "fx_rates").maybeSingle();
  if (error) throw new RepositoryError(error, "report fx");
  return parseFxTable((data as { value?: unknown } | null)?.value);
}

/**
 * id -> name of the records behind the lookup fields in `keys`, read with the
 * viewer's client: records RLS hides are simply absent ("(restricted)").
 */
export async function loadLookupNames(
  client: CrmSupabaseClient,
  config: RecordConfig,
  rows: RecordRow[],
  keys: Iterable<string>
): Promise<Map<string, string>> {
  const idsByTarget = new Map<CrmObject, Set<string>>();
  for (const key of keys) {
    const field: FieldConfig | undefined = getField(config, key);
    if (!field || field.type !== "lookup") continue;
    for (const row of rows) {
      const v = row[key];
      const target = lookupTarget(field, row);
      if (typeof v === "string" && v && target) (idsByTarget.get(target) ?? idsByTarget.set(target, new Set()).get(target)!).add(v);
    }
  }
  const names = new Map<string, string>();
  await Promise.all(
    [...idsByTarget].map(async ([target, ids]) => {
      const meta = OBJECT_META[target];
      const data = await fetchInChunks(ids, async (part) => {
        const res = await client.from(meta.table).select(`id, ${meta.nameColumn}`).in("id", part).is("deleted_at", null);
        if (res.error) throw new RepositoryError(res.error, `report lookup ${target}`);
        return (res.data ?? []) as unknown as Array<Record<string, string>>;
      });
      for (const r of data) names.set(r.id, r[meta.nameColumn] ?? "");
    })
  );
  return names;
}

