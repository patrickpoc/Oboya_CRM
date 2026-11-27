import { toCsv } from "@/lib/crm/csv";
import type { GroupedReportResult, ReportGroup, TabularReportResult } from "./definition";

/** Pure CSV builders over a run result; `toCsv` keeps the formula-injection guard. */

export function rowsToCsv(result: TabularReportResult): string {
  const header = result.columns.map((c) => c.label);
  const rows = result.rows.map((row) =>
    result.columns.map((c) => {
      const display = row._display?.[c.key];
      if (display) return display;
      const value = row[c.key];
      return typeof value === "boolean" ? String(value) : value;
    })
  );
  return toCsv(header, rows);
}

/** Flattened summary (one row per group, children indented in their own column) or matrix. */
export function groupedToCsv(result: GroupedReportResult, totalLabel = "Total"): string {
  const dims = result.columns.filter((c) => c.kind === "group");
  const aggs = result.aggregates;
  if (result.type === "matrix") {
    const header = [
      dims[0]?.label ?? "",
      ...result.colKeys.flatMap((c) => aggs.map((a) => `${c.label} - ${a.label}`)),
      ...aggs.map((a) => `${totalLabel} - ${a.label}`),
    ];
    const body = result.groups.map((g) => [
      g.label,
      ...result.colKeys.flatMap((c) => {
        const cell = result.cells[g.key]?.[c.key];
        return aggs.map((_, i) => cell?.[i] ?? "");
      }),
      ...g.values,
    ]);
    const total = [totalLabel, ...result.colKeys.flatMap(() => aggs.map(() => "")), ...result.totals];
    return toCsv(header, [...body, total]);
  }
  const header = [...dims.map((d) => d.label), ...aggs.map((a) => a.label)];
  const pad = (labels: string[]) => [...labels, ...Array(Math.max(0, dims.length - labels.length)).fill("")];
  const body: unknown[][] = [];
  const walk = (g: ReportGroup, parents: string[]) => {
    body.push([...pad([...parents, g.label]), ...g.values]);
    for (const c of g.children ?? []) walk(c, [...parents, g.label]);
  };
  for (const g of result.groups) walk(g, []);
  body.push([...pad([totalLabel]), ...result.totals]);
  return toCsv(header, body);
}
