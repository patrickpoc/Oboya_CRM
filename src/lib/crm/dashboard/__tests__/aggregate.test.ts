import { describe, expect, it } from "vitest";
import { convertTotals, parseFxTable, stageSeries, sumByCurrency } from "../aggregate";

const FX = parseFxTable({ base: "USD", rates: { USD: 1, BRL: 0.18, EUR: 1.08, CNY: 0.14 } });

describe("sumByCurrency", () => {
  it("groups by currency, skips empty amounts, accepts numeric strings", () => {
    expect(
      sumByCurrency([
        { amount: 100.1, currency: "BRL" },
        { amount: "200.2", currency: "BRL" },
        { amount: null, currency: "EUR" },
        { amount: 50, currency: "USD" },
        { amount: 10 }, // no currency: USD (column default)
        { amount: "abc", currency: "USD" },
      ])
    ).toEqual({ BRL: 300.3, USD: 60 });
  });
});

describe("parseFxTable", () => {
  it("keeps valid positive rates and forces base = 1", () => {
    expect(parseFxTable({ base: "USD", rates: { BRL: 0.18, XX: 2, EUR: -1, CNY: "0.14" } })).toEqual({
      base: "USD",
      rates: { BRL: 0.18, USD: 1 },
    });
  });
  it("returns null when missing or malformed", () => {
    expect(parseFxTable(null)).toBeNull();
    expect(parseFxTable({ rates: {} })).toBeNull();
    expect(parseFxTable({ base: "USD", rates: [] })).toBeNull();
  });
});

describe("convertTotals", () => {
  it("converts to the base and reports currencies without a rate", () => {
    expect(convertTotals({ BRL: 1000, EUR: 100, USD: 5, JPY: 999 }, FX)).toEqual({
      total: 180 + 108 + 5,
      base: "USD",
      missing: ["JPY"],
    });
  });
  it("without an FX table: no total, every currency is listed as missing", () => {
    expect(convertTotals({ USD: 1, BRL: 2 }, null)).toEqual({ total: null, base: null, missing: ["BRL", "USD"] });
  });
});

describe("stageSeries", () => {
  it("keeps stage order, includes empty stages, counts and converts per stage", () => {
    const series = stageSeries(
      [
        { id: "s1", label: "Prospecting" },
        { id: "s2", label: "Proposal" },
      ],
      [
        { stage_id: "s2", amount: 100, currency: "EUR" },
        { stage_id: "s2", amount: null, currency: "USD" },
        { stage_id: "other", amount: 5, currency: "USD" },
      ],
      FX
    );
    expect(series).toEqual([
      { id: "s1", label: "Prospecting", count: 0, totals: {}, amount: 0 },
      { id: "s2", label: "Proposal", count: 2, totals: { EUR: 100 }, amount: 108 },
    ]);
    expect(stageSeries([{ id: "s1", label: "P" }], [], null)[0].amount).toBeNull();
  });
});
