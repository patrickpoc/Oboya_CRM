"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  BarChart3,
  Building2,
  ChevronRight,
  Clock,
  Handshake,
  ListChecks,
  Target,
  Trophy,
  UserPlus,
  Wallet,
} from "lucide-react";
import { apiFetch } from "@/components/crm/common/api";
import { FilterSelect } from "@/components/crm/common/FilterBar";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/crm/common/states";
import { useUrlFilters } from "@/components/crm/common/use-url-filters";
import { QuickAccessGrid, type QuickAccessItem } from "@/components/crm/dashboard/QuickAccessGrid";
import { PipelineChart } from "@/components/crm/dashboard/PipelineChart";
import { StatCard } from "@/components/crm/dashboard/StatCard";
import { CompleteCheckbox, DueDate, RelatedLink, useViewerClock } from "@/components/crm/activities/activity-parts";
import { RecordFormDrawer } from "@/components/crm/record/RecordFormDrawer";
import { updateRecord, useApiErrorMessage } from "@/components/crm/record/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCrm } from "@/contexts/CrmContext";
import { dueBucket } from "@/lib/crm/activities/due";
import type { DashboardData, MoneyKpi } from "@/lib/crm/dashboard/types";
import { getRecordConfig } from "@/lib/crm/objects/registry";
import { OBJECT_META, type RecordLookups, type RecordRow } from "@/lib/crm/objects/types";

const PLACEHOLDER = "—";
const FILTER_DEFAULTS = { entity_id: "" };

/**
 * Home dashboard body (reference DashboardOverview cadence: KPI row, chart,
 * lists, quick access). Data comes from GET /api/crm/dashboard once the
 * viewer's timezone is known ("today" and "this month" are local).
 */
export function DashboardHome({ lookups }: { lookups: RecordLookups | null }) {
  const t = useTranslations("dashboard");
  const format = useFormatter();
  const { can } = useCrm();
  const clock = useViewerClock();
  const timeZone = clock?.timeZone ?? null;
  const { filters, setFilters } = useUrlFilters(FILTER_DEFAULTS);
  const entityId = filters.entity_id;
  const [data, setData] = useState<DashboardData | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [creating, setCreating] = useState<"lead" | "account" | null>(null);

  useEffect(() => {
    if (!timeZone) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ tz: timeZone });
    if (entityId) params.set("entity_id", entityId);
    apiFetch<DashboardData>(`/api/crm/dashboard?${params}`, { signal: controller.signal, quiet: true })
      .then((json) => {
        setData(json);
        setFailed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [timeZone, entityId, reload]);

  const refresh = () => setReload((n) => n + 1);

  const money = (amount: number, currency: string) =>
    format.number(amount, { style: "currency", currency, maximumFractionDigits: 0 });

  const moneyValue = (kpi: MoneyKpi | null | undefined) => {
    if (!kpi) return PLACEHOLDER;
    if (kpi.converted !== null && kpi.base) return money(kpi.converted, kpi.base);
    const parts = Object.entries(kpi.totals).map(([c, a]) => money(a, c));
    return parts.length > 0 ? parts.join(" · ") : money(0, "USD");
  };

  const moneyNote = (kpi: MoneyKpi | null | undefined, countLabel: string) => {
    if (!kpi) return undefined;
    const lines = [countLabel];
    const currencies = Object.keys(kpi.totals);
    if (kpi.base && kpi.converted !== null) {
      if (currencies.length > 0) lines.push(Object.entries(kpi.totals).map(([c, a]) => money(a, c)).join(" · "));
      if (kpi.missing.length > 0) lines.push(t("kpi.missingRates", { currencies: kpi.missing.join(", ") }));
    } else {
      lines.push(t("kpi.noFx"));
    }
    return lines.join(" — ");
  };

  const quickCandidates: (QuickAccessItem | null)[] = [
    can("leads", "create") && lookups
      ? { key: "newLead", label: t("quick.newLead"), icon: UserPlus, onClick: () => setCreating("lead") }
      : null,
    can("accounts", "create") && lookups
      ? { key: "newAccount", label: t("quick.newAccount"), icon: Building2, onClick: () => setCreating("account") }
      : null,
    can("opportunities") ? { key: "pipeline", label: t("quick.pipeline"), icon: Handshake, href: "/opportunities/pipeline" } : null,
    can("activities") ? { key: "tasks", label: t("quick.myTasks"), icon: ListChecks, href: "/tasks" } : null,
    { key: "reports", label: t("quick.reports"), icon: BarChart3, soon: true },
  ];
  const quickItems = quickCandidates.filter((item): item is QuickAccessItem => item !== null);

  const entities = data?.entities ?? [];

  return (
    <div className="mb-8 space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <FilterSelect
          label={t("entityFilter")}
          value={entityId}
          onChange={(value) => setFilters({ entity_id: value })}
          options={entities}
          allLabel={t("allEntities")}
        />
        {entityId ? <p className="text-xs text-muted-foreground">{t("entityHint")}</p> : null}
      </div>

      {failed && !data ? <ErrorState message={t("failed")} onRetry={refresh} /> : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {can("leads") ? (
          <StatCard
            title={t("kpi.openLeads")}
            value={data?.leads ? format.number(data.leads.open) : PLACEHOLDER}
            change={data?.leads ? t("kpi.slaOverdue", { count: data.leads.slaOverdue }) : undefined}
            icon={Target}
          />
        ) : null}
        {can("opportunities") ? (
          <>
            <StatCard
              title={t("kpi.pipelineValue")}
              value={data ? moneyValue(data.pipeline) : PLACEHOLDER}
              change={moneyNote(data?.pipeline, t("kpi.pipelineCount", { count: data?.pipeline?.count ?? 0 }))}
              icon={Wallet}
            />
            <StatCard
              title={t("kpi.wonThisMonth")}
              value={data ? moneyValue(data.won) : PLACEHOLDER}
              change={moneyNote(data?.won, t("kpi.wonCount", { count: data?.won?.count ?? 0 }))}
              icon={Trophy}
            />
          </>
        ) : null}
        {can("activities") ? (
          <StatCard
            title={t("kpi.tasksToday")}
            value={data?.tasks ? format.number(data.tasks.today) : PLACEHOLDER}
            change={data?.tasks ? t("kpi.tasksOverdue", { count: data.tasks.overdue }) : undefined}
            icon={Clock}
          />
        ) : null}
      </div>

      {can("opportunities") ? (
        data?.stages ? (
          <PipelineChart stages={data.stages} base={data.pipeline?.base ?? null} />
        ) : (
          <Skeleton className="h-80 w-full rounded-xl" />
        )
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {can("activities") ? (
          <MyTasksCard rows={data ? data.myTasks : undefined} onChanged={refresh} />
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>{t("recent.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            {!data ? (
              <ListSkeleton rows={4} />
            ) : data.recent.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">{t("recent.empty")}</p>
            ) : (
              <ul className="divide-y divide-border/50">
                {data.recent.map((item) => {
                  const Icon = getRecordConfig(item.object)?.icon ?? Target;
                  return (
                    <li key={`${item.object}:${item.id}`}>
                      <Link
                        href={`${OBJECT_META[item.object].basePath}/${item.id}`}
                        className="flex min-h-11 items-center gap-3 rounded-md px-1 py-2 transition-colors hover:bg-oboya-soft-white"
                      >
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-oboya-soft-white text-oboya-blue">
                          <Icon className="size-4" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-oboya-blue-dark">{item.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {t(`objects.${item.object}`)} ·{" "}
                            {format.relativeTime(new Date(item.viewedAt), clock?.now ?? new Date(item.viewedAt))}
                          </span>
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-oboya-blue-dark/40" aria-hidden />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <QuickAccessGrid items={quickItems} title={t("quick.title")} soonLabel={t("quick.soon")} />

      {lookups && creating ? (
        <RecordFormDrawer object={creating} open onClose={() => setCreating(null)} lookups={lookups} />
      ) : null}
    </div>
  );
}

function MyTasksCard({ rows, onChanged }: { rows: RecordRow[] | null | undefined; onChanged: () => void }) {
  const t = useTranslations("dashboard.tasks");
  const { can } = useCrm();
  const clock = useViewerClock();
  const errorMessage = useApiErrorMessage();
  const [done, setDone] = useState<Set<string>>(new Set());
  const canEdit = can("activities", "edit");

  const complete = async (row: RecordRow) => {
    setDone((prev) => new Set(prev).add(row.id));
    try {
      await updateRecord("activity", row.id, { status: "done" });
      toast.success(t("completed"));
      window.dispatchEvent(new Event("crm:nav-counts"));
      onChanged();
    } catch (error) {
      setDone((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
      toast.error(errorMessage(error));
    }
  };

  const visible = (rows ?? []).filter((r) => !done.has(r.id));

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>{t("title")}</CardTitle>
        <Link href="/tasks" className="text-xs font-medium text-oboya-blue-light hover:underline">
          {t("viewAll")}
        </Link>
      </CardHeader>
      <CardContent>
        {rows === undefined || !clock ? (
          <ListSkeleton rows={4} />
        ) : rows === null ? (
          <ErrorState />
        ) : visible.length === 0 ? (
          <EmptyState icon={ListChecks} title={t("empty")} className="p-6 md:p-6" />
        ) : (
          <ul className="divide-y divide-border/50">
            {visible.map((row) => {
              const overdue = dueBucket(typeof row.due_at === "string" ? row.due_at : null, clock.now, clock.timeZone) === "overdue";
              return (
                <li key={row.id} className="flex items-start gap-3 py-2.5">
                  {canEdit ? (
                    <CompleteCheckbox done={false} label={t("complete")} onToggle={() => void complete(row)} />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/activities/${row.id}`}
                      className="block truncate text-sm font-medium text-oboya-blue-dark hover:underline"
                    >
                      {String(row.subject ?? "")}
                    </Link>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      {row.due_at ? <DueDate value={row.due_at} overdue={overdue} /> : <span>{t("noDue")}</span>}
                      <RelatedLink row={row} />
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
