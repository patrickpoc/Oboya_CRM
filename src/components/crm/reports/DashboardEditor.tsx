"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, useApiErrorMessage } from "@/components/crm/common/api";
import { LiveAnnouncer, WidgetFrame } from "@/components/crm/home/WidgetControls";
import { Button } from "@/components/ui/button";
import { moveWidget, newWidgetId, normalizePositions } from "@/lib/crm/home/widgets";
import {
  REPORTS_API,
  type DashboardDto,
  type ReportListResponse,
  type ReportSummary,
} from "@/lib/crm/reports/api-contract";
import {
  MAX_DASHBOARD_WIDGETS,
  REPORT_CHART_TYPES,
  type DashboardWidget,
  type ReportChartType,
} from "@/lib/crm/reports/definition";

const selectClass = "h-8 rounded-md border border-border/70 bg-white px-2 text-xs text-oboya-blue-dark";

/**
 * Dashboard edit mode: add widgets from saved reports, remove, reorder (buttons
 * or Alt+Arrow, announced via aria-live), resize, chart override, save.
 */
export function DashboardEditor({
  dashboard,
  onCancel,
  onSaved,
}: {
  dashboard: DashboardDto;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("reports.dashboards");
  const tChart = useTranslations("reports.dashboards.chartOverride");
  const errorMessage = useApiErrorMessage();
  const [widgets, setWidgets] = useState<DashboardWidget[]>(() => normalizePositions(dashboard.widgets));
  const [reports, setReports] = useState<ReportSummary[] | null>(null);
  const [pick, setPick] = useState("");
  const [saving, setSaving] = useState(false);
  const [announce, setAnnounce] = useState("");

  useEffect(() => {
    apiFetch<ReportListResponse>(REPORTS_API.reports, { quiet: true })
      .then((r) => setReports(r.reports))
      .catch(() => setReports([]));
  }, []);

  const names = useMemo(() => new Map((reports ?? []).map((r) => [r.id, r.name])), [reports]);
  const nameOf = (w: DashboardWidget) => names.get(w.reportId) ?? t("reportFallback");
  const patch = (id: string, next: Partial<DashboardWidget>) =>
    setWidgets((list) => list.map((w) => (w.id === id ? { ...w, ...next } : w)));

  const move = (index: number, delta: -1 | 1) => {
    const to = index + delta;
    if (to < 0 || to >= widgets.length) return;
    setAnnounce(t("moved", { name: nameOf(widgets[index]), position: to + 1, count: widgets.length }));
    setWidgets((list) => moveWidget(list, index, delta));
  };

  const add = () => {
    if (!pick) return;
    setWidgets((list) => [...list, { id: newWidgetId(), reportId: pick, size: "md", position: list.length }]);
    setAnnounce(t("added", { name: names.get(pick) ?? "" }));
    setPick("");
  };

  const remove = (index: number) => {
    setAnnounce(t("removed", { name: nameOf(widgets[index]) }));
    setWidgets((list) => normalizePositions(list.filter((_, i) => i !== index)));
  };

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch(REPORTS_API.dashboard(dashboard.id), {
        method: "PATCH",
        body: JSON.stringify({ widgets: normalizePositions(widgets) }),
      });
      toast.success(t("saved"));
      onSaved();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const used = new Set(widgets.map((w) => w.reportId));
  const addable = (reports ?? []).filter((r) => !used.has(r.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border/60 bg-white p-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground sm:max-w-sm">
          {t("addFromReports")}
          <select value={pick} onChange={(e) => setPick(e.target.value)} className={selectClass} disabled={reports === null}>
            <option value="">{addable.length === 0 && reports ? t("noReports") : t("selectReport")}</option>
            {addable.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={add} disabled={!pick || widgets.length >= MAX_DASHBOARD_WIDGETS}>
          <Plus aria-hidden /> {t("addWidget")}
        </Button>
        <div className="ml-auto flex gap-2">
          <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={onCancel} disabled={saving}>
            {t("cancel")}
          </Button>
          <Button type="button" size="sm" className="rounded-full" onClick={() => void save()} disabled={saving}>
            {t("save")}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t("editHint")}</p>
      <LiveAnnouncer message={announce} />
      {widgets.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">{t("emptyEditor")}</p> : null}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {widgets.map((w, i) => (
          <WidgetFrame
            key={w.id}
            label={nameOf(w)}
            index={i}
            count={widgets.length}
            size={w.size}
            onMove={(d) => move(i, d)}
            onSize={(size) => patch(w.id, { size })}
            onRemove={() => remove(i)}
            extra={
              <select
                value={w.chartOverride?.type ?? ""}
                onChange={(e) => {
                  const type = e.target.value as ReportChartType | "";
                  patch(w.id, { chartOverride: type ? { type, metric: w.chartOverride?.metric ?? 0 } : undefined });
                }}
                aria-label={tChart("label", { name: nameOf(w) })}
                className={selectClass}
              >
                <option value="">{tChart("default")}</option>
                {REPORT_CHART_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {tChart(type)}
                  </option>
                ))}
              </select>
            }
          >
            <div className="rounded-b-xl border border-t-0 border-border/60 bg-white p-4 text-sm text-oboya-blue-dark">{nameOf(w)}</div>
          </WidgetFrame>
        ))}
      </div>
    </div>
  );
}
