import "server-only";

import type { CrmSupabaseClient } from "@/lib/supabase/server";
import { groupedToCsv, rowsToCsv } from "./csv-format";
import { REPORT_EXPORT_CAP, type GroupedReportResult, type ReportDefinition } from "./definition";
import { resolveConfig, runReport, runTabular, type RunOptions } from "./engine";
import { fallbackTranslate } from "./labels";

/**
 * CSV of a report. `rows`: the matching records with the report's columns
 * (the list columns when the report has none), capped at REPORT_EXPORT_CAP.
 * `grouped`: the flattened summary/matrix (rows for a tabular report).
 */
export async function reportCsv(
  client: CrmSupabaseClient,
  def: ReportDefinition,
  mode: "rows" | "grouped",
  opts: RunOptions
): Promise<string> {
  const config = resolveConfig(def);
  if (mode === "grouped" && def.type !== "tabular") {
    const result = (await runReport(client, def, opts)) as GroupedReportResult;
    return groupedToCsv(result, (opts.t ?? fallbackTranslate)("reports.engine.total"));
  }
  const tabular: ReportDefinition = {
    ...def,
    type: "tabular",
    columns: def.columns.length ? def.columns : config.listColumns,
    rowGroups: [],
    columnGroup: undefined,
    aggregates: [],
    sort: def.type === "tabular" ? def.sort : undefined,
    chart: { type: "none", metric: 0 },
  };
  return rowsToCsv(await runTabular(client, tabular, opts, REPORT_EXPORT_CAP));
}
