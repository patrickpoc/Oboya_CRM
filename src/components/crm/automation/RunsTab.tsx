"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { ChevronDown, Play, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { DataTable, type DataTableColumn } from "@/components/crm/data-table/DataTable";
import { StatusPill, type PillTone } from "@/components/crm/common/StatusPill";
import { apiFetch, useErrorMessage, useSetupData } from "@/components/crm/setup/shared";
import { Button } from "@/components/ui/button";
import { useCrm } from "@/contexts/CrmContext";
import { AUTOMATION_API, type RunResponse, type RunsResponse } from "@/lib/crm/automation/api-contract";
import type { AutomationRun, RunStatus } from "@/lib/crm/automation/types";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<RunStatus, PillTone> = { ok: "success", partial: "warning", failed: "danger", skipped: "muted" };

export function RunsTab() {
  const t = useTranslations("automation.runs");
  const format = useFormatter();
  const errorMessage = useErrorMessage();
  const { can } = useCrm();
  const canRun = can("automation", "edit");
  const { data, error, loading, reload } = useSetupData<RunsResponse>(`${AUTOMATION_API.runs}?limit=20`);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const runs = data?.runs ?? [];
  const last = runs[0];
  const when = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium", timeStyle: "short" });

  const runNow = async () => {
    setRunning(true);
    try {
      const res = await apiFetch<RunResponse>(AUTOMATION_API.run, { method: "POST" });
      if (res.run.status === "failed") toast.error(t("runFailed"));
      else toast.success(t("ranOk"));
      await reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRunning(false);
    }
  };

  const counts = (r: AutomationRun) => {
    const entries = Object.entries(r.counts).filter(([, n]) => n > 0);
    if (entries.length === 0) return <span className="text-muted-foreground">{t("noCounts")}</span>;
    return (
      <span className="flex flex-wrap gap-1">
        {entries.map(([k, n]) => (
          <StatusPill key={k} tone="neutral" size="xs">
            {t.has(`sections.${k}`) ? t(`sections.${k}`) : k}: {n}
          </StatusPill>
        ))}
      </span>
    );
  };

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const columns: DataTableColumn<AutomationRun>[] = [
    { key: "startedAt", header: t("time"), sortable: true, sortValue: (r) => r.startedAt, cell: (r) => <span className="whitespace-nowrap">{when(r.startedAt)}</span> },
    { key: "trigger", header: t("trigger"), cell: (r) => (t.has(`triggers.${r.trigger}`) ? t(`triggers.${r.trigger}`) : r.trigger) },
    {
      key: "status",
      header: t("status"),
      cell: (r) => <StatusPill tone={STATUS_TONE[r.status] ?? "neutral"}>{t(`statuses.${r.status}`)}</StatusPill>,
    },
    { key: "counts", header: t("counts"), cell: counts },
    {
      key: "errors",
      header: t("errors"),
      cell: (r) =>
        r.errors.length === 0 ? (
          <span className="text-muted-foreground">{t("errorCount", { count: 0 })}</span>
        ) : (
          <div>
            <button
              type="button"
              aria-expanded={open.has(r.id)}
              onClick={() => toggle(r.id)}
              className="inline-flex min-h-11 items-center gap-1 text-oboya-orange hover:underline md:min-h-6"
            >
              {t("errorCount", { count: r.errors.length })}
              <ChevronDown className={cn("size-3.5 transition-transform", open.has(r.id) && "rotate-180")} aria-hidden />
              <span className="sr-only">{open.has(r.id) ? t("hideErrors") : t("showErrors")}</span>
            </button>
            {open.has(r.id) ? (
              <ul className="mt-1 space-y-1 text-xs">
                {r.errors.map((e, i) => (
                  <li key={i} className="break-words">
                    <span className="font-mono text-oboya-blue-dark">{e.section}</span>: {e.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-oboya-blue-dark">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => void reload()} className="min-h-11 md:min-h-8" aria-label={t("refresh")}>
            <RefreshCw className={cn("size-4", loading && "animate-spin")} aria-hidden />
          </Button>
          {canRun ? (
            <Button type="button" onClick={() => void runNow()} disabled={running} className="min-h-11 md:min-h-8">
              <Play className="size-4" aria-hidden /> {running ? t("running") : t("runNow")}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="rounded-xl border border-border/60 bg-white p-4" aria-live="polite">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("lastRun")}</p>
        {last ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-display text-lg font-semibold text-oboya-blue-dark">{when(last.startedAt)}</span>
            <StatusPill tone={STATUS_TONE[last.status] ?? "neutral"}>{t(`statuses.${last.status}`)}</StatusPill>
            <span className="text-sm text-muted-foreground">{t.has(`triggers.${last.trigger}`) ? t(`triggers.${last.trigger}`) : last.trigger}</span>
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">{t("never")}</p>
        )}
      </div>

      <DataTable
        data={runs}
        columns={columns}
        getRowId={(r) => r.id}
        pageSize={10}
        loading={loading && !data}
        error={error && !data ? errorMessage(error) : null}
        onRetry={() => void reload()}
        emptyMessage={t("empty")}
        mobileLayout="cards"
      />
    </div>
  );
}
