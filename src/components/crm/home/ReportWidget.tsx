"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { browserTimeZone } from "@/lib/crm/activities/due";
import { apiFetch } from "@/components/crm/common/api";
import { ReportPanel } from "@/components/crm/reports/ReportPanel";
import { DashboardGrid, useDashboard } from "@/components/crm/reports/DashboardView";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  REPORTS_API,
  type ReportResponse,
  type RunResponse,
} from "@/lib/crm/reports/api-contract";

function Unavailable() {
  const t = useTranslations("home");
  return (
    <Card className="h-full">
      <CardContent className="py-8 text-center text-sm text-muted-foreground">{t("unavailable")}</CardContent>
    </Card>
  );
}

/** A saved report on Home: runs it with the viewer's own visibility. */
export function ReportWidget({ id }: { id: string }) {
  const t = useTranslations("home");
  const [state, setState] = useState<{ report: ReportResponse["report"]; run: RunResponse } | "failed" | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const tz = encodeURIComponent(browserTimeZone());
    const init = { signal: controller.signal, quiet: true };
    Promise.all([
      apiFetch<ReportResponse>(REPORTS_API.report(id), init),
      apiFetch<RunResponse>(`${REPORTS_API.runSaved(id)}?tz=${tz}`, init),
    ])
      .then(([r, run]) => setState({ report: r.report, run }))
      .catch(() => {
        if (!controller.signal.aborted) setState("failed");
      });
    return () => controller.abort();
  }, [id]);

  if (state === null) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (state === "failed") return <Unavailable />;
  return (
    <div className="flex flex-col gap-1.5">
      <ReportPanel result={state.run.result} chart={state.report.definition.chart} title={state.report.name} />
      <Link href={`/reports/${id}`} className="self-end text-xs font-medium text-oboya-blue-light hover:underline">
        {t("openReport")}
      </Link>
    </div>
  );
}

/** A pinned dashboard: its widgets render inline. */
export function DashboardWidgetInline({ id }: { id: string }) {
  const t = useTranslations("home");
  const { dashboard, data, failed } = useDashboard(id);
  if (failed && !dashboard) return <Unavailable />;
  if (!dashboard) return <Skeleton className="h-64 w-full rounded-xl" />;
  return (
    <section aria-label={dashboard.name} className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-base font-semibold text-oboya-blue-dark">{dashboard.name}</h2>
        <Link href={`/reports/dashboards/${id}`} className="text-xs font-medium text-oboya-blue-light hover:underline">
          {t("openDashboard")}
        </Link>
      </div>
      <DashboardGrid widgets={dashboard.widgets} data={data} />
    </section>
  );
}
