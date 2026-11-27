"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Download, Pencil } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { ApiError, apiFetch } from "@/components/crm/common/api";
import { ErrorState } from "@/components/crm/common/states";
import { ReportChart } from "@/components/crm/dashboard/ReportChart";
import { CrmPageHeader } from "@/components/crm/layout/CrmPageHeader";
import { ReportNotices } from "@/components/crm/reports/ReportNotices";
import { ReportTable } from "@/components/crm/reports/ReportTable";
import { buttonVariants } from "@/components/ui/button";
import { browserTimeZone } from "@/lib/crm/activities/due";
import { Skeleton } from "@/components/ui/skeleton";
import { useCrm } from "@/contexts/CrmContext";
import { getRecordConfig } from "@/lib/crm/objects/registry";
import {
  REPORTS_API,
  type ReportDto,
  type ReportResponse,
  type RunResponse,
} from "@/lib/crm/reports/api-contract";
import type { ReportDefinition, ReportResult } from "@/lib/crm/reports/definition";
import { cn } from "@/lib/utils";


/** Chart, notices and table of a result: used by the saved view and the builder preview. */
export function ReportOutput({
  result,
  chart,
  title,
}: {
  result: ReportResult;
  chart: ReportDefinition["chart"];
  title?: string;
}) {
  return (
    <div className="space-y-4">
      <ReportNotices result={result} />
      {result.type !== "tabular" && chart.type !== "none" ? (
        <ReportChart result={result} chart={chart} title={title} />
      ) : null}
      <ReportTable result={result} />
    </div>
  );
}

const outlineButton = cn(buttonVariants({ variant: "outline", size: "sm" }), "rounded-full");

export function ReportView({ id }: { id: string }) {
  const t = useTranslations("reports.view");
  const format = useFormatter();
  const { can } = useCrm();
  const [report, setReport] = useState<ReportDto | null>(null);
  const [result, setResult] = useState<ReportResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  // The report and its run load separately: a stale definition (422) still shows the header and Edit.
  useEffect(() => {
    const controller = new AbortController();
    const init = { signal: controller.signal, quiet: true };
    apiFetch<ReportResponse>(REPORTS_API.report(id), init)
      .then((r) => {
        setReport(r.report);
        setLoadError(null);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(e instanceof ApiError && e.status === 404 ? t("notFound") : e instanceof ApiError && e.status === 403 ? t("forbidden") : t("failed"));
      });
    apiFetch<RunResponse>(`${REPORTS_API.runSaved(id)}?tz=${encodeURIComponent(browserTimeZone())}`, init)
      .then((run) => {
        setResult(run.result);
        setRunError(null);
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        const status = e instanceof ApiError ? e.status : 0;
        setRunError(status === 422 ? t("invalid") : status === 403 ? t("forbidden") : status === 404 ? t("notFound") : t("failed"));
      });
    return () => controller.abort();
  }, [id, reload, t]);

  const retry = useCallback(() => {
    setLoadError(null);
    setRunError(null);
    setReport(null);
    setResult(null);
    setReload((n) => n + 1);
  }, []);

  if (loadError) return <ErrorState message={loadError} onRetry={retry} />;
  if (!report) {
    return (
      <div className="space-y-4" role="status" aria-label={t("running")}>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const def = report.definition;
  const config = getRecordConfig(def.object);
  const exportAllowed = can("reports", "export") && (!config || can(config.module, "export"));
  const tzQuery = `&tz=${encodeURIComponent(browserTimeZone())}`;

  return (
    <>
      <CrmPageHeader
        title={report.name}
        description={
          <>
            {report.description ? <p className="text-sm text-muted-foreground">{report.description}</p> : null}
            {result ? (
              <p className="text-xs text-muted-foreground">
                {t("generated", { time: format.dateTime(new Date(result.generatedAt), { dateStyle: "medium", timeStyle: "short" }) })}
              </p>
            ) : null}
          </>
        }
        actions={
          <>
            <Link href="/reports" className={outlineButton}>
              {t("back")}
            </Link>
            {exportAllowed && result ? (
              <a href={`${REPORTS_API.export(id, "rows")}${tzQuery}`} download className={outlineButton}>
                <Download aria-hidden /> {t("exportRows")}
              </a>
            ) : null}
            {exportAllowed && def.type !== "tabular" ? (
              <a href={`${REPORTS_API.export(id, "grouped")}${tzQuery}`} download className={outlineButton}>
                <Download aria-hidden /> {t("exportGrouped")}
              </a>
            ) : null}
            {report.canEdit && can("reports", "edit") ? (
              <Link
                href={`/reports/${id}/edit`}
                className={cn(buttonVariants({ size: "sm" }), "rounded-full bg-oboya-blue text-white hover:bg-oboya-blue/90")}
              >
                <Pencil aria-hidden /> {t("edit")}
              </Link>
            ) : null}
          </>
        }
      />
      {result ? (
        <ReportOutput result={result} chart={def.chart} title={report.name} />
      ) : runError ? (
        <ErrorState message={runError} onRetry={retry} />
      ) : (
        <Skeleton className="h-64 w-full" role="status" aria-label={t("running")} />
      )}
    </>
  );
}
