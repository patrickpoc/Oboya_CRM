import type { RecordRow } from "@/lib/crm/objects/types";

/** Max opportunities loaded by the kanban (all stages). */
export const PIPELINE_LIMIT = 500;

/** Query-string keys of the kanban (owner view, entity, close-date range). */
export const PIPELINE_PARAM_KEYS = ["view", "entity_id", "close_date"] as const;

/** List-query params for the kanban: only its own filters, fixed sort and size. */
export function pipelineParams(source: Record<string, string | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of PIPELINE_PARAM_KEYS) {
    const value = source[key];
    if (value) params.set(key, value);
  }
  params.set("sort", "close_date");
  params.set("dir", "asc");
  params.set("pageSize", String(PIPELINE_LIMIT));
  return params;
}

/** Canonical key of the kanban filters (shared by page and client). */
export function pipelineKey(source: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const key of PIPELINE_PARAM_KEYS) if (source[key]) params.set(key, source[key]!);
  return params.toString();
}

export type ColumnSummary = {
  count: number;
  /** Sum of amount per currency. */
  totals: Record<string, number>;
  /** Sum of amount × probability / 100 per currency. */
  weighted: Record<string, number>;
};

export function summarizeColumn(rows: RecordRow[]): ColumnSummary {
  const summary: ColumnSummary = { count: rows.length, totals: {}, weighted: {} };
  for (const row of rows) {
    const amount = typeof row.amount === "number" ? row.amount : Number(row.amount);
    if (row.amount == null || !Number.isFinite(amount)) continue;
    const currency = typeof row.currency === "string" ? row.currency : "USD";
    const probability = typeof row.probability === "number" ? row.probability : 0;
    summary.totals[currency] = round2((summary.totals[currency] ?? 0) + amount);
    summary.weighted[currency] = round2((summary.weighted[currency] ?? 0) + (amount * probability) / 100);
  }
  return summary;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Open opportunity whose close date (YYYY-MM-DD) is before `today` (YYYY-MM-DD). */
export function isOverdue(closeDate: unknown, kind: string | undefined, today: string): boolean {
  return kind === "open" && typeof closeDate === "string" && closeDate !== "" && closeDate < today;
}
