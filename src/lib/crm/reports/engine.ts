import "server-only";

import type { CrmSupabaseClient } from "@/lib/supabase/server";
import { safeTimeZone } from "@/lib/crm/dashboard/time";
import { getField, parseListQuery } from "@/lib/crm/objects/query";
import { getRecordConfig } from "@/lib/crm/objects/registry";
import type { FieldConfig, ListQuery, RecordConfig, RecordRow } from "@/lib/crm/objects/types";
import { loadLookups } from "@/lib/crm/repositories/lookups";
import { attachDisplay, attachVirtual } from "@/lib/crm/repositories/object-repository";
import { aggregateRows } from "./aggregate";
import {
  MAX_REPORT_LIMIT,
  REPORT_EXPORT_CAP,
  REPORT_SCAN_CAP,
  validateDefinition,
  type DefinitionIssue,
  type GroupedReportResult,
  type ReportAggregateInfo,
  type ReportColumn,
  type ReportDefinition,
  type ReportResult,
  type TabularReportResult,
} from "./definition";
import { fallbackTranslate, makeLabeler, type Translate } from "./labels";
import { loadLookupNames, nameColumns, readFx, scanRows, selectFor } from "./source";

/** Rows a tabular run may read, whatever the definition or caller asks. */
const MAX_REPORT_LIMIT_ROWS = REPORT_EXPORT_CAP;

export type RunOptions = {
  userId: string;
  /** IANA zone for buckets and datetime filters (invalid falls back to UTC). */
  timeZone: string;
  /** BCP 47 tag for bucket labels. */
  locale: string;
  /** Full-key translator; English fallbacks when omitted. */
  t?: Translate;
};

/** Thrown for a definition that does not validate against its object (routes map it to 422). */
export class ReportDefinitionError extends Error {
  constructor(readonly issues: DefinitionIssue[]) {
    super("invalid_definition");
    this.name = "ReportDefinitionError";
  }
}

export function resolveConfig(def: ReportDefinition): RecordConfig {
  const config = getRecordConfig(def.object);
  if (!config) throw new ReportDefinitionError([{ path: "object", code: "wrong_object" }]);
  const check = validateDefinition(def, config);
  if (!check.ok) throw new ReportDefinitionError(check.issues);
  return config;
}

/** The definition's filters/search/scope as a list query (same parsing and whitelists as list URLs). */
export function listQueryOf(config: RecordConfig, def: ReportDefinition): ListQuery {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(def.filters)) params.set(key, value);
  if (def.q) params.set("q", def.q);
  params.set("view", def.scope === "mine" ? "mine" : "all");
  return parseListQuery(config, params);
}

const LABELLED_TYPES = new Set(["owner", "lookup", "entity", "picklist", "multipicklist", "boolean"]);

function columnOf(config: RecordConfig, field: FieldConfig, t: Translate): ReportColumn {
  return { key: field.key, label: t(`${config.namespace}.${field.labelKey}`), type: field.type, kind: "field" };
}

/** Tabular rows; `limit` rows are read (the export passes REPORT_EXPORT_CAP). */
export async function runTabular(
  client: CrmSupabaseClient,
  def: ReportDefinition,
  opts: RunOptions,
  limit: number
): Promise<TabularReportResult> {
  const config = getRecordConfig(def.object)!;
  const timeZone = safeTimeZone(opts.timeZone);
  const t = opts.t ?? fallbackTranslate;
  const fields = def.columns.map((k) => getField(config, k)).filter((f): f is FieldConfig => Boolean(f));
  const sort = def.sort ?? config.defaultSort;
  const scan = await scanRows(client, config, listQueryOf(config, def), { userId: opts.userId }, {
    select: selectFor(config, def.columns, nameColumns(config)),
    wanted: Math.max(1, Math.min(limit, MAX_REPORT_LIMIT_ROWS)),
    timeZone,
    order: { field: sort.field, asc: sort.dir === "asc" },
  });
  const rows = scan.rows;
  await attachVirtual(client, config, rows, new Set(fields.filter((f) => f.virtual).map((f) => f.key)));
  await attachDisplay(client, config, rows);

  // Labels for references and options; unreadable references never show an id.
  const lookups = await loadLookups(client);
  const label = makeLabeler({ config, lookups, lookupNames: new Map(), t, locale: opts.locale });
  for (const row of rows) {
    const display = (row._display ??= {});
    for (const field of fields) {
      const value = row[field.key];
      if (!LABELLED_TYPES.has(field.type) || display[field.key]) continue;
      if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) continue;
      const keys = Array.isArray(value)
        ? value.map((v) => (typeof v === "object" && v ? String((v as { entityId?: string }).entityId ?? "") : String(v)))
        : [String(value)];
      display[field.key] = keys.map((k) => label(field, k)).join(", ");
      // A reference without a readable label is restricted: keep the label, drop the id.
      if (field.type === "owner" || field.type === "lookup" || field.type === "entity") row[field.key] = null;
    }
    if (!def.columns.includes("owner_id")) delete row.owner_id;
  }

  return {
    type: "tabular",
    object: def.object,
    columns: fields.map((f) => columnOf(config, f, t)),
    timeZone,
    generatedAt: new Date().toISOString(),
    rows: rows as RecordRow[],
    total: scan.total,
  };
}

async function runGrouped(
  client: CrmSupabaseClient,
  def: ReportDefinition & { type: "summary" | "matrix" },
  opts: RunOptions
): Promise<GroupedReportResult> {
  const config = getRecordConfig(def.object)!;
  const timeZone = safeTimeZone(opts.timeZone);
  const t = opts.t ?? fallbackTranslate;
  const dims = [...def.rowGroups, ...(def.columnGroup ? [def.columnGroup] : [])];
  const dimKeys = dims.map((g) => g.field);
  const aggKeys = def.aggregates.flatMap((a) => (a.field ? [a.field] : []));

  const [scan, fx, lookups] = await Promise.all([
    scanRows(client, config, listQueryOf(config, def), { userId: opts.userId }, {
      select: selectFor(config, [...dimKeys, ...aggKeys]),
      wanted: REPORT_SCAN_CAP,
      timeZone,
    }),
    readFx(client),
    loadLookups(client),
  ]);
  const used = new Set([...dimKeys, ...aggKeys]);
  await attachVirtual(client, config, scan.rows, used);
  const lookupNames = await loadLookupNames(client, config, scan.rows, dimKeys);
  const label = makeLabeler({ config, lookups, lookupNames, t, locale: opts.locale });
  const out = aggregateRows(scan.rows, def, { config, timeZone, fx, label });

  const aggregates: ReportAggregateInfo[] = def.aggregates.map((a) => {
    const field = a.field ? getField(config, a.field) : undefined;
    return {
      fn: a.fn,
      field: a.field,
      label: field
        ? t(`reports.engine.agg.${a.fn}`, { field: t(`${config.namespace}.${field.labelKey}`) })
        : t("reports.engine.agg.count"),
    };
  });
  const columns: ReportColumn[] = [
    ...dims.flatMap((g) => {
      const field = getField(config, g.field);
      return field ? [{ ...columnOf(config, field, t), kind: "group" as const }] : [];
    }),
    ...def.aggregates.map((a, i): ReportColumn => {
      const field = a.field ? getField(config, a.field) : undefined;
      return { key: `agg:${i}`, label: aggregates[i].label, type: field?.type ?? "number", kind: "aggregate" };
    }),
  ];

  return {
    type: def.type,
    object: def.object,
    columns,
    timeZone,
    generatedAt: new Date().toISOString(),
    truncated: scan.capped ? { scanned: scan.rows.length, total: scan.total } : undefined,
    aggregates,
    ...out,
  };
}

/** Runs a definition with the viewer's client (RLS decides which records count). */
export async function runReport(
  client: CrmSupabaseClient,
  def: ReportDefinition,
  opts: RunOptions
): Promise<ReportResult> {
  resolveConfig(def);
  if (def.type === "tabular") return runTabular(client, def, opts, Math.min(def.limit, MAX_REPORT_LIMIT));
  return runGrouped(client, def as ReportDefinition & { type: "summary" | "matrix" }, opts);
}
