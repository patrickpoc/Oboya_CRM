import { z } from "zod";
import { baseFieldSchema } from "./schema";
import { RESERVED_QUERY_KEYS } from "./types";
import type {
  FieldConfig,
  ListFilters,
  ListQuery,
  ListView,
  RecordConfig,
  SortDir,
} from "./types";

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const EXPORT_LIMIT = 5000;
const MAX_FILTER_VALUES = 20;
const MAX_QUERY_LENGTH = 100;

export function getField(config: RecordConfig, key: string): FieldConfig | undefined {
  return config.fields.find((f) => f.key === key);
}

/** Real columns selected for list/get (virtual fields are loaded by handlers). */
export function selectColumns(config: RecordConfig): string {
  const cols = new Set(["id", "owner_id", "created_at", "updated_at"]);
  for (const f of config.fields) if (!f.virtual) cols.add(f.key);
  for (const f of config.fields) if (f.currencyField) cols.add(f.currencyField);
  for (const n of config.nameFields) cols.add(n);
  if (config.path) cols.add(config.path.field);
  return [...cols].join(",");
}

export function sortableKeys(config: RecordConfig): string[] {
  const keys = config.fields.filter((f) => f.sortable && !f.virtual).map((f) => f.key);
  if (!keys.includes(config.defaultSort.field)) keys.push(config.defaultSort.field);
  return keys;
}

export function filterableFields(config: RecordConfig): FieldConfig[] {
  return config.fields.filter((f) => f.filterable);
}

/** Display name from nameFields. */
export function recordName(config: RecordConfig, row: Record<string, unknown>): string {
  return config.nameFields
    .map((k) => row[k])
    .filter((v) => typeof v === "string" && v.trim() !== "")
    .join(" ");
}

/**
 * Date range filter value "YYYY-MM-DD..YYYY-MM-DD" (inclusive; one side may be
 * empty). Null when `value` is not a valid range.
 */
export function parseDateRange(value: string): { from: string | null; to: string | null } | null {
  const parts = value.split("..");
  if (parts.length !== 2) return null;
  const [from, to] = parts.map((p) => p.trim() || null);
  if (!from && !to) return null;
  const valid = (d: string | null) => d === null || z.iso.date().safeParse(d).success;
  if (!valid(from) || !valid(to)) return null;
  if (from && to && from > to) return null;
  return { from, to };
}

/** Validates one filter value against the field type; null when invalid. */
function parseFilterValue(field: FieldConfig, raw: string): string | null {
  const value = raw.trim();
  if (!value || value.length > 100) return null;
  switch (field.type) {
    case "boolean":
      return value === "true" || value === "false" ? value : null;
    case "multipicklist":
    case "tags": {
      const item = baseFieldSchema({ ...field, type: field.type === "tags" ? "text" : "picklist" });
      return item.safeParse(value).success ? value.toLowerCase() : null;
    }
    case "entity":
      return z.guid().safeParse(value).success ? value : null;
    case "date":
    case "datetime": {
      // A day, or an inclusive range "from..to" (either side may be empty).
      // datetime: UTC days; anything else falls back to the field schema.
      const range = parseDateRange(value);
      if (range) return `${range.from ?? ""}..${range.to ?? ""}`;
      if (field.type === "datetime") {
        const parsed = baseFieldSchema(field).safeParse(value);
        return parsed.success ? String(parsed.data) : null;
      }
      return z.iso.date().safeParse(value).success ? value : null;
    }
    default: {
      const parsed = baseFieldSchema(field).safeParse(value);
      return parsed.success ? String(parsed.data) : null;
    }
  }
}

function readInt(raw: string | null, fallback: number, min: number, max: number) {
  const n = raw === null ? NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Parses list params from a query string. Sort and filter keys are whitelisted
 * from the config; anything else is ignored. Filter values: comma separated.
 */
export function parseListQuery(
  config: RecordConfig,
  params: URLSearchParams,
  options: { maxPageSize?: number } = {}
): ListQuery {
  const viewRaw = params.get("view");
  const view: ListView = viewRaw === "all" || viewRaw === "recent" ? viewRaw : "mine";
  const sortRaw = params.get("sort") ?? "";
  const sort = sortableKeys(config).includes(sortRaw) ? sortRaw : config.defaultSort.field;
  const dirRaw = params.get("dir");
  const dir: SortDir =
    dirRaw === "asc" || dirRaw === "desc"
      ? dirRaw
      : sort === config.defaultSort.field
        ? config.defaultSort.dir
        : "asc";

  const filters: ListFilters = {};
  for (const field of filterableFields(config)) {
    const raw = params.get(field.key);
    if (!raw) continue;
    const values = raw
      .split(",")
      .slice(0, MAX_FILTER_VALUES)
      .map((v) => parseFilterValue(field, v))
      .filter((v): v is string => v !== null);
    if (values.length > 0) filters[field.key] = [...new Set(values)];
  }

  const maxPageSize = options.maxPageSize ?? MAX_PAGE_SIZE;
  return {
    view,
    q: (params.get("q") ?? "").trim().slice(0, MAX_QUERY_LENGTH),
    filters,
    sort,
    dir,
    page: readInt(params.get("page"), 0, 0, 10_000),
    pageSize: readInt(params.get("pageSize"), DEFAULT_PAGE_SIZE, 1, maxPageSize),
  };
}

/** Escapes LIKE metacharacters (backslash is Postgres' default LIKE escape). */
export function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Quotes a value for a PostgREST logic-tree filter (`or=(...)`). */
export function quoteFilterValue(value: string): string {
  return `"${value.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}

/**
 * PostgREST `or` filter matching `q` (ilike, contains) across searchable
 * columns, or null when there is nothing to search. `*` is PostgREST's alias
 * for `%`, and control characters are meaningless here, so both are dropped.
 */
export function buildSearchFilter(config: RecordConfig, q: string): string | null {
  const term = q.replace(/[*\u0000-\u001f]/g, " ").trim().slice(0, MAX_QUERY_LENGTH);
  if (!term) return null;
  const columns = config.fields.filter((f) => f.searchable && !f.virtual).map((f) => f.key);
  if (columns.length === 0) return null;
  const pattern = quoteFilterValue(`%${escapeLike(term)}%`);
  return columns.map((c) => `${c}.ilike.${pattern}`).join(",");
}

/** Keys a list view keeps in the URL: reserved keys + filterable field keys. */
export function listParamKeys(config: RecordConfig): string[] {
  return [...RESERVED_QUERY_KEYS, ...filterableFields(config).map((f) => f.key)];
}

/**
 * Canonical query string of a list view (known keys only, non-empty, sorted).
 * Used by the page (server) and ObjectListView (client) to share the first load.
 */
export function listParamsKey(config: RecordConfig, source: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const key of listParamKeys(config).sort()) {
    const value = source[key];
    if (value) params.set(key, value);
  }
  return params.toString();
}
