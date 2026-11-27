import { describe, expect, it } from "vitest";
import { accountConfig } from "@/lib/crm/objects/account";
import { leadConfig } from "@/lib/crm/objects/lead";
import { opportunityConfig } from "@/lib/crm/objects/opportunity";
import type { RecordLookups } from "@/lib/crm/objects/types";
import { aggregateRows, dimKeys, scanPlan } from "../aggregate";
import { ReportDefinitionSchema, type ReportDefinitionInput } from "../definition";
import { fallbackTranslate, makeLabeler } from "../labels";

const lookups: RecordLookups = {
  picklists: { lead_source: [{ value: "web", label: "Website" }] },
  users: [{ value: "u1", label: "Ana", active: true }],
  entities: [{ value: "e1", label: "Oboya BR" }],
  stages: [
    { value: "s1", label: "Proposal", kind: "open", probability: 40, color: null },
    { value: "s2", label: "Won", kind: "won", probability: 100, color: null },
  ],
};
const fx = { base: "USD", rates: { USD: 1, BRL: 0.2 } };

function setup(input: Partial<ReportDefinitionInput>, config = opportunityConfig, lookupNames = new Map<string, string>()) {
  const def = ReportDefinitionSchema.parse({ version: 1, object: config.object, type: "summary", ...input });
  const label = makeLabeler({ config, lookups, lookupNames, t: fallbackTranslate, locale: "en" });
  return { def, deps: { config, timeZone: "UTC", fx, label } };
}

const opp = (stage: string, amount: number | null, currency = "USD", extra: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  stage_id: stage,
  amount,
  currency,
  ...extra,
});

describe("aggregateRows", () => {
  const rows = [
    opp("s1", 100, "USD", { owner_id: "u1" }),
    opp("s1", 300, "USD", { owner_id: "u1" }),
    opp("s2", 50, "USD", { owner_id: "u2" }),
    opp("s2", null, "USD", { owner_id: "u1" }),
  ];

  it("summarizes one level with count, sum, avg, min and max", () => {
    const { def, deps } = setup({
      rowGroups: [{ field: "stage_id" }],
      aggregates: [{ fn: "count" }, { fn: "sum", field: "amount" }, { fn: "avg", field: "amount" }, { fn: "min", field: "amount" }, { fn: "max", field: "amount" }],
    });
    const out = aggregateRows(rows, def, deps);
    expect(out.groups.map((g) => [g.label, ...g.values])).toEqual([
      ["Proposal", 2, 400, 200, 100, 300], // sorted by the first aggregate, biggest first
      ["Won", 2, 50, 50, 50, 50], // the null amount counts but is not averaged
    ]);
    expect(out.totals).toEqual([4, 450, 150, 50, 300]);
  });

  it("summarizes two levels and sorts by an aggregate then the group limit", () => {
    const { def, deps } = setup({
      rowGroups: [{ field: "stage_id" }, { field: "owner_id" }],
      aggregates: [{ fn: "sum", field: "amount" }],
      sort: { field: "agg:0", dir: "asc" },
      limit: 1,
    });
    const out = aggregateRows(rows, def, deps);
    expect(out.groups).toHaveLength(1); // limit
    expect(out.groups[0].label).toBe("Won");
    expect(out.groups[0].children?.map((c) => [c.label, c.values[0]])).toEqual([["Ana", 0], ["(restricted)", 50]]);
    expect(out.totals).toEqual([450]); // totals ignore the limit
  });

  it("builds a matrix with cells and grand totals", () => {
    const { def, deps } = setup({
      type: "matrix",
      rowGroups: [{ field: "stage_id" }],
      columnGroup: { field: "owner_id" },
      aggregates: [{ fn: "count" }, { fn: "sum", field: "amount" }],
    });
    const out = aggregateRows(rows, def, deps);
    expect(out.colKeys.map((c) => c.label).sort()).toEqual(["Ana", "(restricted)"].sort());
    expect(out.cells["s1"]["u1"]).toEqual([2, 400]);
    const hiddenKey = out.colKeys.find((c) => c.label === "(restricted)")!.key;
    expect(hiddenKey).not.toBe("u2");
    expect(out.cells["s2"][hiddenKey]).toEqual([1, 50]);
    expect(out.cells["s2"]["u1"]).toEqual([1, 0]);
    expect(out.totals).toEqual([4, 450]);
    expect(out.groups.find((g) => g.key === "s1")?.values).toEqual([2, 400]);
  });

  it("converts currencies with the FX table and reports missing rates", () => {
    const { def, deps } = setup({
      rowGroups: [{ field: "stage_id" }],
      aggregates: [{ fn: "sum", field: "amount" }],
    });
    const out = aggregateRows(
      [opp("s1", 100, "BRL"), opp("s1", 10, "USD"), opp("s1", 999, "JPY"), opp("s2", 5, "EUR")],
      def,
      deps,
    );
    expect(out.groups.find((g) => g.key === "s1")?.values).toEqual([30]); // 100 * 0.2 + 10
    expect(out.currency).toEqual({ base: "USD", missing: ["EUR", "JPY"] });
  });

  it("treats every currency as missing without an FX table", () => {
    const { def, deps } = setup({ rowGroups: [{ field: "stage_id" }], aggregates: [{ fn: "sum", field: "amount" }] });
    const out = aggregateRows([opp("s1", 10, "USD")], def, { ...deps, fx: null });
    expect(out.currency.missing).toEqual(["USD"]);
    expect(out.totals).toEqual([0]);
  });

  it("buckets dates in the viewer's timezone, chronologically, empty last", () => {
    const { def, deps } = setup({
      rowGroups: [{ field: "close_date", bucket: "month" }],
      aggregates: [{ fn: "count" }],
    });
    const out = aggregateRows(
      [opp("s1", 1, "USD", { close_date: "2026-03-10" }), opp("s1", 1, "USD", { close_date: "2026-01-02" }), opp("s1", 1, "USD", { close_date: null }), opp("s1", 1, "USD", { close_date: "2026-01-20" })],
      def,
      deps,
    );
    expect(out.groups.map((g) => [g.key, g.values[0]])).toEqual([["2026-01", 2], ["2026-03", 1], ["", 1]]);
    expect(out.groups[0].label).toBe("January 2026");
  });

  it("counts a multi-value field once per value but totals once per row", () => {
    const { def, deps } = setup({ rowGroups: [{ field: "tags" }], aggregates: [{ fn: "count" }] }, leadConfig);
    const out = aggregateRows(
      [{ id: "1", tags: ["a", "b"] }, { id: "2", tags: ["a"] }, { id: "3", tags: [] }],
      def,
      deps,
    );
    expect(Object.fromEntries(out.groups.map((g) => [g.key, g.values[0]]))).toEqual({ a: 2, b: 1, "": 1 });
    expect(out.totals).toEqual([3]);
  });
});

describe("restricted references", () => {
  it("replaces restricted group and column keys with opaque ones", () => {
    const { def, deps } = setup({
      type: "matrix",
      rowGroups: [{ field: "owner_id" }],
      columnGroup: { field: "stage_id" },
      aggregates: [{ fn: "count" }],
    });
    const out = aggregateRows([opp("s1", 1, "USD", { owner_id: "secret-uuid" }), opp("s2", 1, "USD", { owner_id: "u1" })], def, deps);
    expect(JSON.stringify(out)).not.toContain("secret-uuid");
    const hidden = out.groups.find((g) => g.label === "(restricted)")!;
    expect(hidden.key).toMatch(/^restricted:\d+$/);
    expect(out.cells[hidden.key]["s1"]).toEqual([1]);
  });
});

describe("dimKeys", () => {
  it("reads entity links and de-duplicates", () => {
    const field = accountConfig.fields.find((f) => f.type === "entity")!;
    expect(dimKeys({ [field.key]: [{ entityId: "e1", isPrimary: true }, { entityId: "e1", isPrimary: false }] }, field, undefined, "UTC")).toEqual(["e1"]);
  });
});

describe("scanPlan", () => {
  it("chunks by 1000 and flags the cap", () => {
    expect(scanPlan(2500, 20_000)).toEqual({ offsets: [0, 1000, 2000], truncated: false });
    const capped = scanPlan(25_000, 20_000);
    expect(capped.offsets).toHaveLength(20);
    expect(capped.truncated).toBe(true);
    expect(scanPlan(0, 20_000)).toEqual({ offsets: [], truncated: false });
    // A caller cannot lift the scan cap.
    const huge = scanPlan(1_000_000, 1_000_000);
    expect(huge.offsets).toHaveLength(20);
    expect(huge.truncated).toBe(true);
  });
});

describe("makeLabeler", () => {
  const label = (names = new Map<string, string>()) =>
    makeLabeler({ config: opportunityConfig, lookups, lookupNames: names, t: fallbackTranslate, locale: "en" });
  const field = (key: string) => opportunityConfig.fields.find((f) => f.key === key)!;

  it("labels stages, owners, entities, picklists and empty", () => {
    const l = label();
    expect(l(field("stage_id"), "s2")).toBe("Won");
    expect(l(field("owner_id"), "u1")).toBe("Ana");
    expect(l(field("entity_id"), "e1")).toBe("Oboya BR");
    expect(l(field("lead_source"), "web")).toBe("Website");
    expect(l(field("lead_source"), "")).toBe("(none)");
  });

  it("shows (restricted), never the id, for references the viewer cannot read", () => {
    const l = label(new Map([["acc1", "Acme"]]));
    expect(l(field("owner_id"), "u-hidden")).toBe("(restricted)");
    expect(l(field("entity_id"), "e-hidden")).toBe("(restricted)");
    expect(l(field("account_id"), "acc1")).toBe("Acme");
    expect(l(field("account_id"), "acc-hidden")).toBe("(restricted)");
    expect(l(field("account_id"), "acc-hidden")).not.toContain("acc-hidden");
  });
});
