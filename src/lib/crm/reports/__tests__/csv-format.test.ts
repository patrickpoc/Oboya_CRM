import { describe, expect, it } from "vitest";
import { groupedToCsv, rowsToCsv } from "../csv-format";
import type { GroupedReportResult, TabularReportResult } from "../definition";

const base = { object: "opportunity" as const, timeZone: "UTC", generatedAt: "2026-01-01T00:00:00Z" };

describe("report CSV", () => {
  it("rows mode uses _display labels and guards formulas", () => {
    const result: TabularReportResult = {
      ...base,
      type: "tabular",
      total: 2,
      columns: [
        { key: "name", label: "Name", type: "text", kind: "field" },
        { key: "stage_id", label: "Stage", type: "picklist", kind: "field" },
        { key: "amount", label: "Amount", type: "currency", kind: "field" },
      ],
      rows: [
        { id: "1", name: '=HYPERLINK("x")', stage_id: "s1", amount: -5, _display: { stage_id: "Proposal" } },
        { id: "2", name: "+cmd", stage_id: "s2", amount: 10 },
      ],
    };
    const lines = rowsToCsv(result).replace("﻿", "").trim().split("\n");
    expect(lines[0]).toBe("Name,Stage,Amount");
    expect(lines[1]).toBe(`"'=HYPERLINK(""x"")",Proposal,-5`);
    expect(lines[2]).toBe("'+cmd,s2,10");
  });

  it("grouped mode flattens two levels and a total row", () => {
    const result: GroupedReportResult = {
      ...base,
      type: "summary",
      columns: [
        { key: "stage_id", label: "Stage", type: "picklist", kind: "group" },
        { key: "owner_id", label: "Owner", type: "owner", kind: "group" },
        { key: "agg:0", label: "Count", type: "number", kind: "aggregate" },
      ],
      aggregates: [{ fn: "count", label: "Count" }],
      groups: [{ key: "s1", label: "-Proposal", values: [3], children: [{ key: "u1", label: "Ana", values: [3] }] }],
      colKeys: [],
      cells: {},
      totals: [3],
      currency: { base: "USD", missing: [] },
    };
    const lines = groupedToCsv(result).replace("﻿", "").trim().split("\n");
    expect(lines).toEqual(["Stage,Owner,Count", "'-Proposal,,3", "'-Proposal,Ana,3", "Total,,3"]);
  });

  it("grouped mode flattens a matrix", () => {
    const result: GroupedReportResult = {
      ...base,
      type: "matrix",
      columns: [{ key: "stage_id", label: "Stage", type: "picklist", kind: "group" }],
      aggregates: [{ fn: "count", label: "Count" }],
      groups: [{ key: "s1", label: "Proposal", values: [3] }],
      colKeys: [{ key: "u1", label: "Ana" }],
      cells: { s1: { u1: [3] } },
      totals: [3],
      currency: { base: "USD", missing: [] },
    };
    const lines = groupedToCsv(result).replace("﻿", "").trim().split("\n");
    expect(lines).toEqual(["Stage,Ana - Count,Total - Count", "Proposal,3,3", "Total,,3"]);
  });
});
