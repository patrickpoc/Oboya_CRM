import { describe, expect, it } from "vitest";
import { opportunityConfig } from "@/lib/crm/objects/opportunity";
import {
  ReportDefinitionSchema,
  validateDefinition,
  type ReportDefinitionInput,
} from "../definition";

const config = opportunityConfig;

function check(input: Partial<ReportDefinitionInput>) {
  const def = ReportDefinitionSchema.parse({
    version: 1,
    object: "opportunity",
    type: "summary",
    ...input,
  });
  return validateDefinition(def, config);
}
const codes = (r: ReturnType<typeof check>) =>
  r.ok ? [] : r.issues.map((i) => `${i.path}:${i.code}`);

const stage = { field: "stage_id" };

describe("validateDefinition", () => {
  it("accepts a valid summary", () => {
    expect(
      check({
        rowGroups: [stage],
        aggregates: [{ fn: "count" }, { fn: "sum", field: "amount" }],
        chart: { type: "bar", metric: 1 },
      }),
    ).toEqual({ ok: true });
  });

  it("accepts a valid matrix", () => {
    expect(
      check({
        type: "matrix",
        rowGroups: [stage],
        columnGroup: { field: "close_date", bucket: "month" },
        aggregates: [{ fn: "sum", field: "amount" }],
        chart: { type: "bar", metric: 0, stacked: true },
      }),
    ).toEqual({ ok: true });
  });

  it("rejects unknown fields", () => {
    expect(
      codes(
        check({
          rowGroups: [{ field: "nope" }],
          aggregates: [{ fn: "count" }],
        }),
      ),
    ).toContain("rowGroups.0.field:unknown_field");
  });

  it("rejects a bucket on a non-date field", () => {
    expect(
      codes(
        check({
          rowGroups: [{ field: "stage_id", bucket: "month" }],
          aggregates: [{ fn: "count" }],
        }),
      ),
    ).toContain("rowGroups.0.bucket:bucket_not_date");
  });

  it("rejects sum on text", () => {
    expect(
      codes(
        check({
          rowGroups: [stage],
          aggregates: [{ fn: "sum", field: "name" }],
        }),
      ),
    ).toContain("aggregates.0.field:not_aggregatable");
  });

  it("requires a column group on a matrix", () => {
    expect(
      codes(
        check({
          type: "matrix",
          rowGroups: [stage],
          aggregates: [{ fn: "count" }],
        }),
      ),
    ).toContain("columnGroup:matrix_shape");
  });

  it("rejects a donut with two dimensions", () => {
    expect(
      codes(
        check({
          rowGroups: [stage, { field: "close_date", bucket: "year" }],
          aggregates: [{ fn: "count" }],
          chart: { type: "donut", metric: 0 },
        }),
      ),
    ).toContain("chart.type:chart_dimension");
  });

  it("enforces limits", () => {
    const base = { version: 1, object: "opportunity", type: "summary" };
    expect(
      ReportDefinitionSchema.safeParse({ ...base, limit: 2001 }).success,
    ).toBe(false);
    expect(
      ReportDefinitionSchema.safeParse({
        ...base,
        columns: Array(21).fill("name"),
      }).success,
    ).toBe(false);
    expect(
      ReportDefinitionSchema.safeParse({
        ...base,
        rowGroups: Array(3).fill(stage),
      }).success,
    ).toBe(false);
    expect(
      ReportDefinitionSchema.safeParse({
        ...base,
        aggregates: Array(7).fill({ fn: "count" }),
      }).success,
    ).toBe(false);
  });
});

describe("validateDefinition caps", () => {
  const base = { version: 1, object: "opportunity", type: "summary", aggregates: [{ fn: "count" }] } as const;
  it("rejects what the zod schema would have rejected", () => {
    const def = ReportDefinitionSchema.parse({ ...base, rowGroups: [stage] });
    const bad = (patch: object) => validateDefinition({ ...def, ...patch } as typeof def, config);
    expect(bad({ limit: 5000 }).ok).toBe(false);
    expect(bad({ limit: 0 }).ok).toBe(false);
    expect(bad({ rowGroups: [stage, { field: "owner_id" }, { field: "entity_id" }] }).ok).toBe(false);
    expect(bad({ aggregates: Array.from({ length: 7 }, () => ({ fn: "count" })) }).ok).toBe(false);
    expect(bad({ type: "matrix", rowGroups: [stage, { field: "owner_id" }], columnGroup: { field: "entity_id" } }).ok).toBe(false);
  });
});

