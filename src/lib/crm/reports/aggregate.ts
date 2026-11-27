import { round2, type FxTable } from "@/lib/crm/dashboard/aggregate";
import { getField } from "@/lib/crm/objects/query";
import type { EntityLink, FieldConfig, RecordConfig } from "@/lib/crm/objects/types";
import { bucketKey } from "./buckets";
import {
  REPORT_SCAN_CAP,
  rowPath,
  type ReportAggregate,
  type ReportBucket,
  type ReportCell,
  type ReportDefinition,
  type ReportGroup,
  type ReportGroupBy,
} from "./definition";
import type { makeLabeler } from "./labels";

/**
 * Pure grouping and aggregation over already-scanned rows (no Supabase, no
 * React). Multi-value fields (tags, multipicklist, entity links) count a row
 * once per value; totals count every row once.
 */

export const MAX_MATRIX_COLUMNS = 50;
const CURRENCY_RE = /^[A-Z]{3}$/;

type Row = Record<string, unknown>;
type Label = ReturnType<typeof makeLabeler>;

export type AggregateDeps = {
  config: RecordConfig;
  timeZone: string;
  /** crm_settings.fx_rates; null converts nothing (every currency is "missing"). */
  fx: FxTable | null;
  label: Label;
};

export type AggregateOutput = {
  groups: ReportGroup[];
  colKeys: { key: string; label: string }[];
  cells: Record<string, Record<string, ReportCell>>;
  totals: number[];
  currency: { base: string; missing: string[] };
};

/** Group keys of one row for a dimension ("" = empty). */
export function dimKeys(row: Row, field: FieldConfig, bucket: ReportBucket | undefined, timeZone: string): string[] {
  const value = row[field.key];
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return [""];
  let keys: string[];
  if (field.type === "date" || field.type === "datetime") {
    keys = [bucketKey(value, bucket ?? "day", timeZone) ?? ""];
  } else if (Array.isArray(value)) {
    keys = value.map((v) => (field.type === "entity" ? String((v as EntityLink).entityId ?? "") : String(v)));
  } else keys = [String(value)];
  const unique = [...new Set(keys.map((k) => k.trim()))];
  return unique.length ? unique : [""];
}

// ---------------------------------------------------------------- accumulators

type Acc = { count: number; sum: number; n: number; min: number | null; max: number | null };
const newAccs = (n: number): Acc[] => Array.from({ length: n }, () => ({ count: 0, sum: 0, n: 0, min: null, max: null }));

function finish(aggregate: ReportAggregate, acc: Acc): number {
  switch (aggregate.fn) {
    case "count":
      return acc.count;
    case "sum":
      return round2(acc.sum);
    case "avg":
      return acc.n ? round2(acc.sum / acc.n) : 0;
    case "min":
      return round2(acc.min ?? 0);
    case "max":
      return round2(acc.max ?? 0);
  }
}

function feed(accs: Acc[], values: Array<number | null>) {
  accs.forEach((acc, i) => {
    acc.count++;
    const v = values[i];
    if (v === null) return;
    acc.sum += v;
    acc.n++;
    acc.min = acc.min === null ? v : Math.min(acc.min, v);
    acc.max = acc.max === null ? v : Math.max(acc.max, v);
  });
}

type Node = { key: string; accs: Acc[]; children: Map<string, Node>; cols: Map<string, Acc[]> };
const newNode = (key: string, n: number): Node => ({ key, accs: newAccs(n), children: new Map(), cols: new Map() });
function child<T>(map: Map<string, T>, key: string, make: () => T): T {
  let v = map.get(key);
  if (v === undefined) map.set(key, (v = make()));
  return v;
}

// ---------------------------------------------------------------- main

export function aggregateRows(rows: Row[], def: ReportDefinition, deps: AggregateDeps): AggregateOutput {
  const { config, timeZone, fx, label } = deps;
  const aggs = def.aggregates;
  const missing = new Set<string>();

  // Numeric value of each aggregate for a row; currency amounts are converted to the FX base.
  const aggFields = aggs.map((a) => (a.field ? getField(config, a.field) : undefined));
  const rowValues = (row: Row): Array<number | null> =>
    aggs.map((a, i) => {
      const field = aggFields[i];
      if (a.fn === "count" || !field) return null;
      const raw = row[field.key];
      if (raw === null || raw === undefined || raw === "") return null;
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) return null;
      if (field.type !== "currency") return n;
      const code = field.currencyField ? row[field.currencyField] : "USD";
      const currency = typeof code === "string" && CURRENCY_RE.test(code) ? code : "USD";
      const rate = fx?.rates[currency];
      if (rate === undefined) {
        missing.add(currency);
        return null;
      }
      return n * rate;
    });

  const rowDims = def.rowGroups.map((g) => ({ g, field: getField(config, g.field) }));
  const colDim = def.columnGroup ? { g: def.columnGroup, field: getField(config, def.columnGroup.field) } : null;
  const keysOf = (d: { g: ReportGroupBy; field: FieldConfig | undefined }, row: Row) =>
    d.field ? dimKeys(row, d.field, d.g.bucket, timeZone) : [""];

  const totals = newAccs(aggs.length);
  const roots = new Map<string, Node>();
  const colTotals = new Map<string, Acc[]>();

  for (const row of rows) {
    const values = rowValues(row);
    feed(totals, values);
    if (rowDims.length === 0) continue;
    const colKeys = colDim ? keysOf(colDim, row) : [];
    for (const k1 of keysOf(rowDims[0], row)) {
      const node = child(roots, k1, () => newNode(k1, aggs.length));
      feed(node.accs, values);
      for (const ck of colKeys) feed(child(node.cols, ck, () => newAccs(aggs.length)), values);
      if (rowDims[1]) {
        for (const k2 of keysOf(rowDims[1], row)) {
          const sub = child(node.children, k2, () => newNode(k2, aggs.length));
          feed(sub.accs, values);
        }
      }
    }
    for (const ck of colKeys) feed(child(colTotals, ck, () => newAccs(aggs.length)), values);
  }

  const bucketed = (i: number) => {
    const d = i === 0 ? rowDims[0] : rowDims[1];
    return Boolean(d?.field && (d.field.type === "date" || d.field.type === "datetime"));
  };
  const finishAll = (accs: Acc[]) => aggs.map((a, i) => finish(a, accs[i]));

  // Restricted references get opaque keys so no id reaches the client.
  let restrictedSeq = 0;
  const opaque = new Map<string, string>();
  const outKeyOf = (field: FieldConfig | undefined, key: string): string => {
    if (!field || key === "" || !label.isRestricted(field, key)) return key;
    const id = `${field.key}\u0000${key}`;
    let out = opaque.get(id);
    if (!out) opaque.set(id, (out = `restricted:${restrictedSeq++}`));
    return out;
  };
  const rootByOut = new Map<string, Node>();

  const toGroups = (nodes: Iterable<Node>, level: 0 | 1, dim: (typeof rowDims)[number]): ReportGroup[] => {
    const groups = [...nodes].map((n) => ({
      key: n.key,
      outKey: outKeyOf(dim.field, n.key),
      label: dim.field ? label(dim.field, n.key, dim.g.bucket ?? (bucketed(level) ? "day" : undefined)) : n.key,
      values: finishAll(n.accs),
      node: n,
    }));
    const sorted = sortGroups(groups, def.sort, bucketed(level), aggs.length);
    return (level === 0 ? sorted.slice(0, def.limit) : sorted).map(({ node, outKey, ...group }): ReportGroup => {
      if (level === 0) rootByOut.set(outKey, node);
      const children = level === 0 && rowDims[1] ? toGroups(node.children.values(), 1, rowDims[1]) : undefined;
      return children ? { ...group, key: outKey, children } : { ...group, key: outKey };
    });
  };

  const groups = rowDims.length ? toGroups(roots.values(), 0, rowDims[0]) : [];

  let colKeys: Array<{ key: string; raw: string; label: string }> = [];
  const cells: AggregateOutput["cells"] = {};
  if (colDim?.field) {
    const colBucketed = colDim.field.type === "date" || colDim.field.type === "datetime";
    const kept = [...colTotals.entries()]
      .map(([key, accs]) => ({ key, total: finish(aggs[0], accs[0] ?? newAccs(1)[0]) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, MAX_MATRIX_COLUMNS)
      .map((c) => c.key);
    const labelOf = (key: string) => label(colDim.field!, key, colDim.g.bucket ?? (colBucketed ? "day" : undefined));
    colKeys = kept
      .map((key) => ({ key: outKeyOf(colDim.field, key), raw: key, label: labelOf(key) }))
      .sort((a, b) => compare(a.key, b.key, a.label, b.label, colBucketed));
    for (const group of groups) {
      const node = rootByOut.get(group.key);
      if (!node) continue;
      const row: Record<string, ReportCell> = {};
      for (const { key, raw } of colKeys) {
        const accs = node.cols.get(raw);
        if (accs) row[key] = finishAll(accs);
      }
      cells[rowPath([group.key])] = row;
    }
  }

  return {
    groups,
    colKeys: colKeys.map(({ key, label }) => ({ key, label })),
    cells,
    totals: finishAll(totals),
    currency: { base: fx?.base ?? "USD", missing: [...missing].sort() },
  };
}

/** Bucketed keys sort chronologically, everything else by label; the empty group goes last. */
function compare(ak: string, bk: string, al: string, bl: string, bucketed: boolean): number {
  if (ak === "" || bk === "") return ak === bk ? 0 : ak === "" ? 1 : -1;
  return bucketed ? (ak < bk ? -1 : ak > bk ? 1 : 0) : al.localeCompare(bl);
}

function sortGroups<T extends { key: string; label: string; values: number[] }>(
  groups: T[],
  sort: ReportDefinition["sort"],
  bucketed: boolean,
  aggCount: number,
): T[] {
  const agg = sort ? /^agg:(\d+)$/.exec(sort.field) : null;
  const index = agg ? Number(agg[1]) : -1;
  const byAgg = index >= 0 && index < aggCount;
  const dir = sort?.dir === "desc" ? -1 : 1;
  return [...groups].sort((a, b) => {
    if (byAgg) return (a.values[index] - b.values[index]) * dir || compare(a.key, b.key, a.label, b.label, bucketed);
    if (sort?.field === "label") return compare(a.key, b.key, a.label, b.label, bucketed) * dir;
    // Default: chronological for dates, else the biggest first.
    if (bucketed) return compare(a.key, b.key, a.label, b.label, true);
    return (b.values[0] ?? 0) - (a.values[0] ?? 0) || compare(a.key, b.key, a.label, b.label, false);
  });
}

/** What the scan reads: how many rows to fetch and whether the scan cap cut the data. */
export function scanPlan(total: number, wanted: number, chunk = 1000): { offsets: number[]; truncated: boolean } {
  wanted = Math.max(0, Math.min(wanted, REPORT_SCAN_CAP)); // never above the scan cap, whatever the caller asks
  const n = Math.min(total, wanted);
  const offsets: number[] = [];
  for (let o = 0; o < n; o += chunk) offsets.push(o);
  return { offsets, truncated: total > wanted };
}
