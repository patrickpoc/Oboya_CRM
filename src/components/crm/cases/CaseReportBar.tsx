"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { apiFetch } from "@/components/crm/common/api";
import { formatResolution } from "@/lib/crm/cases/report";
import type { CaseReportResult } from "@/app/api/crm/cases/report/route";

/** Quiet summary strip shown in the cases filter bar; never blocks the list. */
export function CaseReportBar() {
  const t = useTranslations("cases");
  const [report, setReport] = useState<CaseReportResult | null>(null);

  useEffect(() => {
    let active = true;
    void apiFetch<CaseReportResult>("/api/crm/cases/report", { quiet: true })
      .then((value) => {
        if (active) setReport(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!report) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span>{t("report.total", { count: report.total })}</span>
      <span className="text-oboya-blue">{t("report.open", { count: report.open })}</span>
      <span className="text-oboya-green">{t("report.resolved", { count: report.resolved })}</span>
      <span className="text-oboya-orange">{t("report.breached", { count: report.breached })}</span>
      <span>
        {t("report.avg")}: <strong className="font-medium text-oboya-blue-dark">{formatResolution(report.avgResolutionMinutes)}</strong>
      </span>
    </div>
  );
}
