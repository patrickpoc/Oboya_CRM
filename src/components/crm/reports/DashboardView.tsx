"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowLeft, LayoutDashboard, Pencil } from "lucide-react";
import { apiFetch } from "@/components/crm/common/api";
import { EmptyState, ErrorState } from "@/components/crm/common/states";
import { ReportPanel } from "@/components/crm/reports/ReportPanel";
import { CrmPageHeader } from "@/components/crm/layout/CrmPageHeader";
import { DashboardEditor } from "@/components/crm/reports/DashboardEditor";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCrm } from "@/contexts/CrmContext";
import { browserTimeZone } from "@/lib/crm/activities/due";
import { WIDGET_SPAN } from "@/lib/crm/home/widgets";
import {
  REPORTS_API,
  type DashboardDataResponse,
  type DashboardDto,
  type DashboardResponse,
  type DashboardWidgetData,
} from "@/lib/crm/reports/api-contract";
import type { DashboardWidget } from "@/lib/crm/reports/definition";
import { cn } from "@/lib/utils";


/** Loads a dashboard (definition + per-widget data). A failed widget never breaks the others. */
export function useDashboard(id: string) {
  const [dashboard, setDashboard] = useState<DashboardDto | null>(null);
  const [data, setData] = useState<Record<string, DashboardWidgetData> | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const tz = encodeURIComponent(browserTimeZone());
    const init = { signal: controller.signal, quiet: true };
    Promise.all([
      apiFetch<DashboardResponse>(REPORTS_API.dashboard(id), init),
      apiFetch<DashboardDataResponse>(`${REPORTS_API.dashboardData(id)}?tz=${tz}`, init).catch(
        (): DashboardDataResponse | null => null,
      ),
    ])
      .then(([d, w]) => {
        setDashboard(d.dashboard);
        setData(w?.widgets ?? {});

        setFailed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [id, reload]);

  const refresh = useCallback(() => setReload((n) => n + 1), []);
  return { dashboard, data, failed, refresh };
}

function WidgetCard({
  widget,
  data,
  loading,
}: {
  widget: DashboardWidget;
  data: DashboardWidgetData | undefined;
  loading: boolean;
}) {
  const t = useTranslations("reports.dashboards");
  return (
    <div className={cn("min-w-0", WIDGET_SPAN[widget.size])}>
      {loading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : data?.ok ? (
        <div className="flex flex-col gap-1.5">
          <ReportPanel
            result={data.result}
            chart={data.chart}
            title={data.report.name}
            compact={widget.size === "sm"}
          />
          <Link
            href={`/reports/${data.report.id}`}
            className="self-end text-xs font-medium text-oboya-blue-light hover:underline"
          >
            {t("openReport")}
          </Link>
        </div>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">{t("unavailable")}</CardContent>
        </Card>
      )}
    </div>
  );
}

/** Responsive widget grid: 1 column on mobile, 2 from md, 4 from xl (sm = 1, md = 2, lg = full). */
export function DashboardGrid({
  widgets,
  data,
}: {
  widgets: DashboardWidget[];
  data: Record<string, DashboardWidgetData> | null;
}) {
  const sorted = [...widgets].sort((a, b) => a.position - b.position);
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {sorted.map((w) => (
        <WidgetCard key={w.id} widget={w} data={data?.[w.id]} loading={data === null} />
      ))}
    </div>
  );
}

export function DashboardView({ id }: { id: string }) {
  const t = useTranslations("reports.dashboards");
  const { can } = useCrm();
  const { dashboard, data, failed, refresh } = useDashboard(id);
  const [editing, setEditing] = useState(false);

  if (failed && !dashboard) return <ErrorState message={t("failed")} onRetry={refresh} />;
  if (!dashboard)
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );

  const canEdit = dashboard.canEdit && can("reports", "edit");
  return (
    <>
      <CrmPageHeader
        title={dashboard.name}
        description={dashboard.description || undefined}
        actions={
          <>
            <Link href="/reports?tab=dashboards" className={cn(buttonVariants({ variant: "outline", size: "sm" }), "rounded-full")}>
              <ArrowLeft aria-hidden /> {t("back")}
            </Link>
            {canEdit && !editing ? (
              <Button size="sm" className="rounded-full" onClick={() => setEditing(true)}>
                <Pencil aria-hidden /> {t("edit")}
              </Button>
            ) : null}
          </>
        }
      />
      {editing ? (
        <DashboardEditor
          dashboard={dashboard}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            refresh();
          }}
        />
      ) : dashboard.widgets.length === 0 ? (
        <EmptyState icon={LayoutDashboard} title={t("empty")} description={canEdit ? t("emptyHint") : undefined} />
      ) : (
        <DashboardGrid widgets={dashboard.widgets} data={data} />
      )}
    </>
  );
}
