"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReportResult } from "@/lib/crm/reports/definition";

/** Truncation and missing exchange rates; announced politely. */
export function ReportNotices({ result }: { result: ReportResult }) {
  const t = useTranslations("reports.view.notices");
  const notices: string[] = [];
  if (result.truncated) {
    notices.push(t("truncated", { scanned: result.truncated.scanned, total: result.truncated.total }));
  }
  if (result.type === "tabular" && result.total > result.rows.length) {
    notices.push(t("limited", { shown: result.rows.length, total: result.total }));
  }
  if (result.type !== "tabular" && result.currency.missing.length > 0) {
    notices.push(t("missingFx", { currencies: result.currency.missing.join(", "), base: result.currency.base }));
  }
  if (notices.length === 0) return null;
  return (
    <div role="status" className="space-y-1.5">
      {notices.map((text) => (
        <p
          key={text}
          className="flex items-start gap-2 rounded-lg border border-oboya-yellow-dark/40 bg-oboya-yellow-light/20 px-3 py-2 text-sm text-oboya-blue-dark"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-oboya-yellow-dark" aria-hidden />
          {text}
        </p>
      ))}
    </div>
  );
}
