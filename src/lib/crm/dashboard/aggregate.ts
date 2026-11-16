/**
 * Pure aggregation for the home dashboard: per-currency totals, the static FX
 * table from crm_settings.fx_rates, and the pipeline-by-stage series. No
 * server or React imports.
 */

/** Sum of amounts per ISO currency. */
export type CurrencyTotals = Record<string, number>;

/** crm_settings.fx_rates: 1 unit of `currency` = `rates[currency]` units of `base`. */
export type FxTable = { base: string; rates: Record<string, number> };

export type AmountRow = { amount?: unknown; currency?: unknown };

const CURRENCY_RE = /^[A-Z]{3}$/;

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toAmount(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toCurrency(value: unknown): string {
  return typeof value === "string" && CURRENCY_RE.test(value) ? value : "USD";
}

/** Groups amounts by currency (rows without an amount are skipped). */
export function sumByCurrency(rows: AmountRow[]): CurrencyTotals {
  const out: CurrencyTotals = {};
  for (const row of rows) {
    const amount = toAmount(row.amount);
    if (amount === null) continue;
    const currency = toCurrency(row.currency);
    out[currency] = round2((out[currency] ?? 0) + amount);
  }
  return out;
}

/** Validates crm_settings.fx_rates; null when absent or unusable. */
export function parseFxTable(value: unknown): FxTable | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const base = typeof v.base === "string" && CURRENCY_RE.test(v.base) ? v.base : null;
  if (!base || !v.rates || typeof v.rates !== "object" || Array.isArray(v.rates)) return null;
  const rates: Record<string, number> = {};
  for (const [currency, rate] of Object.entries(v.rates as Record<string, unknown>)) {
    if (CURRENCY_RE.test(currency) && typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
      rates[currency] = rate;
    }
  }
  rates[base] = 1;
  return { base, rates };
}

/**
 * Converts per-currency totals into the FX base currency. `missing` lists the
 * currencies without a rate (left out of `total`).
 */
export function convertTotals(
  totals: CurrencyTotals,
  fx: FxTable | null
): { total: number | null; base: string | null; missing: string[] } {
  if (!fx) return { total: null, base: null, missing: Object.keys(totals).sort() };
  let total = 0;
  const missing: string[] = [];
  for (const [currency, amount] of Object.entries(totals)) {
    const rate = fx.rates[currency];
    if (rate === undefined) missing.push(currency);
    else total += amount * rate;
  }
  return { total: round2(total), base: fx.base, missing: missing.sort() };
}

export type StageInfo = { id: string; label: string };
export type StageRow = AmountRow & { stage_id?: unknown };
export type StagePoint = {
  id: string;
  label: string;
  count: number;
  totals: CurrencyTotals;
  /** Sum converted to the FX base; null without an FX table. */
  amount: number | null;
};

/** One point per stage (in the given order, including empty stages). */
export function stageSeries(stages: StageInfo[], rows: StageRow[], fx: FxTable | null): StagePoint[] {
  const byStage = new Map<string, StageRow[]>();
  for (const row of rows) {
    if (typeof row.stage_id !== "string") continue;
    const list = byStage.get(row.stage_id) ?? [];
    list.push(row);
    byStage.set(row.stage_id, list);
  }
  return stages.map((stage) => {
    const stageRows = byStage.get(stage.id) ?? [];
    const totals = sumByCurrency(stageRows);
    return {
      id: stage.id,
      label: stage.label,
      count: stageRows.length,
      totals,
      amount: fx ? convertTotals(totals, fx).total : null,
    };
  });
}
