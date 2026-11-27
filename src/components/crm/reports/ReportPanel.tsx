"use client";

import { ReportChart } from "@/components/crm/dashboard/ReportChart";
import { ReportTable } from "@/components/crm/reports/ReportTable";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReportDefinition, ReportResult } from "@/lib/crm/reports/definition";

/** Dashboard / Home panel: a chart, or a compact table for tabular reports and reports without a chart. */
export function ReportPanel({
  result,
  chart,
  title,
  compact,
}: {
  result: ReportResult;
  chart: ReportDefinition["chart"];
  title: string;
  compact?: boolean;
}) {
  if (result.type !== "tabular" && chart.type !== "none")
    return <ReportChart result={result} chart={chart} title={title} compact={compact} />;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="max-h-72 overflow-auto">
        <ReportTable result={result} />
      </CardContent>
    </Card>
  );
}
