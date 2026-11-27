"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { LayoutGrid, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, useApiErrorMessage } from "@/components/crm/common/api";
import { FilterSelect } from "@/components/crm/common/FilterBar";
import { ErrorState } from "@/components/crm/common/states";
import { useUrlFilters } from "@/components/crm/common/use-url-filters";
import { useViewerClock } from "@/components/crm/activities/activity-parts";
import { BuiltinWidget } from "@/components/crm/home/BuiltinWidget";
import { DashboardWidgetInline, ReportWidget } from "@/components/crm/home/ReportWidget";
import { LiveAnnouncer, WidgetFrame } from "@/components/crm/home/WidgetControls";
import { RecordFormDrawer } from "@/components/crm/record/RecordFormDrawer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCrm } from "@/contexts/CrmContext";
import type { DashboardData } from "@/lib/crm/dashboard/types";
import {
  availableBuiltins,
  builtinWidgetDef,
  defaultHomeLayout,
  moveWidgetById,
  newWidgetId,
  patchWidgetById,
  removeWidgetById,
  normalizePositions,
  WIDGET_SPAN,
} from "@/lib/crm/home/widgets";
import type { RecordLookups } from "@/lib/crm/objects/types";
import {
  REPORTS_API,
  type DashboardListResponse,
  type HomeLayoutResponse,
  type ReportListResponse,
} from "@/lib/crm/reports/api-contract";
import {
  MAX_HOME_WIDGETS,
  type BuiltinHomeWidget,
  type HomeLayoutScope,
  type HomeWidget,
} from "@/lib/crm/reports/definition";
import { cn } from "@/lib/utils";

const FILTER_DEFAULTS = { entity_id: "" };
const selectClass = "h-8 min-w-0 rounded-md border border-border/70 bg-white px-2 text-xs text-oboya-blue-dark";

type Refs = { reports: Map<string, string>; dashboards: Map<string, string> };

/**
 * Home: the resolved widget layout (user, team, then default; built-in default
 * when nothing is saved or the layout API is unavailable) plus an "Edit home"
 * mode. KPI data comes from GET /api/crm/dashboard once the timezone is known.
 */
export function HomeGrid({ lookups }: { lookups: RecordLookups | null }) {
  const t = useTranslations("dashboard");
  const tHome = useTranslations("home");
  const tEdit = useTranslations("home.edit");
  const errorMessage = useApiErrorMessage();
  const { can, user } = useCrm();
  const clock = useViewerClock();
  const timeZone = clock?.timeZone ?? null;
  const { filters, setFilters } = useUrlFilters(FILTER_DEFAULTS);
  const entityId = filters.entity_id;

  const [data, setData] = useState<DashboardData | null>(null);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [creating, setCreating] = useState<"lead" | "account" | null>(null);
  // undefined = loading; null = no layout (default).
  const [layout, setLayout] = useState<HomeLayoutResponse | null | undefined>(undefined);
  const [draft, setDraft] = useState<HomeWidget[] | null>(null);
  const [refs, setRefs] = useState<Refs>({ reports: new Map(), dashboards: new Map() });
  const [pick, setPick] = useState("");
  const [scope, setScope] = useState<HomeLayoutScope>("user");
  const [saving, setSaving] = useState(false);
  const [announce, setAnnounce] = useState("");

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

  const loadLayout = useCallback(() => {
    apiFetch<HomeLayoutResponse>(REPORTS_API.homeLayout, { quiet: true })
      .then((json) => setLayout(json))
      .catch(() => setLayout(null));
  }, []);
  useEffect(() => {
    loadLayout();
  }, [loadLayout]);

  const refresh = () => setReload((n) => n + 1);
  const editing = draft !== null;
  const canWrite = layout?.canWrite ?? [];
  const visible = (w: HomeWidget) => {
    if (w.kind !== "builtin") return true;
    const def = builtinWidgetDef(w.ref);
    return Boolean(def) && can(def!.module);
  };
  const saved = layout?.widgets && layout.widgets.length > 0 ? layout.widgets : defaultHomeLayout(can);
  // `draft` keeps hidden (no permission / unknown ref) widgets; only rendering filters them.
  const list = normalizePositions(editing ? draft : saved).filter(visible);
  const listIds = list.map((w) => w.id);

  const startEdit = () => {
    setDraft(normalizePositions(saved));
    setScope(canWrite.includes("user") ? "user" : (canWrite[0] ?? "user"));
    setPick("");
    if (can("reports")) {
      apiFetch<ReportListResponse>(REPORTS_API.reports, { quiet: true })
        .then((r) => setRefs((p) => ({ ...p, reports: new Map(r.reports.map((x) => [x.id, x.name])) })))
        .catch(() => {});
      apiFetch<DashboardListResponse>(REPORTS_API.dashboards, { quiet: true })
        .then((r) => setRefs((p) => ({ ...p, dashboards: new Map(r.dashboards.map((x) => [x.id, x.name])) })))
        .catch(() => {});
    }
  };

  // Names for the edit frames / report widgets also come from the lists above.
  const labelOf = (w: HomeWidget) => {
    if (w.kind === "builtin") {
      const def = builtinWidgetDef(w.ref);
      return def ? tHome(def.titleKey) : w.ref;
    }
    return (w.kind === "report" ? refs.reports : refs.dashboards).get(w.ref) ?? tEdit(w.kind === "report" ? "reportFallback" : "dashboardFallback");
  };

  const update = (fn: (items: HomeWidget[]) => HomeWidget[]) => setDraft((d) => (d ? fn(d) : d));
  const move = (index: number, delta: -1 | 1) => {
    const to = index + delta;
    if (to < 0 || to >= list.length) return;
    setAnnounce(tEdit("moved", { name: labelOf(list[index]), position: to + 1, count: list.length }));
    update((d) => moveWidgetById(d, listIds, list[index].id, delta));
  };
  const add = () => {
    if (!pick || list.length >= MAX_HOME_WIDGETS) return;
    const [kind, ref] = pick.split(":") as [HomeWidget["kind"], string];
    const size = kind === "builtin" ? (builtinWidgetDef(ref)?.defaultSize ?? "md") : kind === "dashboard" ? "lg" : "md";
    update((d) => [...normalizePositions(d), { id: newWidgetId(), kind, ref, size, position: d.length }]);
    setAnnounce(tEdit("added", { name: kind === "builtin" ? tHome(`widgets.${ref as BuiltinHomeWidget}`) : ((kind === "report" ? refs.reports : refs.dashboards).get(ref) ?? "") }));
    setPick("");
  };

  // Re-seed the draft from the layout saved at the chosen scope (or the built-in default).
  const changeScope = async (next: HomeLayoutScope) => {
    setScope(next);
    const params = new URLSearchParams({ scope: next });
    if (next === "team" && user.teamId) params.set("teamId", user.teamId);
    try {
      const res = await apiFetch<HomeLayoutResponse>(`${REPORTS_API.homeLayout}?${params}`, { quiet: true });
      setDraft(normalizePositions(res.widgets && res.widgets.length > 0 ? res.widgets : defaultHomeLayout(can)));
    } catch {
      setDraft(normalizePositions(defaultHomeLayout(can)));
    }
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const params = new URLSearchParams({ scope });
      if (scope === "team" && user.teamId) params.set("teamId", user.teamId);
      await apiFetch(`${REPORTS_API.homeLayout}?${params}`, {
        method: "PUT",
        body: JSON.stringify({ widgets: normalizePositions(draft) }),
      });
      if (scope !== "user" && layout?.source === "user") {
        toast.success(tEdit("saved"), {
          description: tEdit("overriddenHint"),
          action: { label: tEdit("reset"), onClick: () => void reset() },
        });
      } else toast.success(tEdit("saved"));
      setDraft(null);
      loadLayout();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    try {
      await apiFetch(`${REPORTS_API.homeLayout}?scope=user`, { method: "DELETE" });
      toast.success(tEdit("resetDone"));
      setDraft(null);
      loadLayout();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const used = new Set(list.map((w) => `${w.kind}:${w.ref}`));
  const builtins = availableBuiltins(list, can);
  const reportOptions = [...refs.reports].filter(([id]) => !used.has(`report:${id}`));
  const dashboardOptions = [...refs.dashboards].filter(([id]) => !used.has(`dashboard:${id}`));

  const renderWidget = (w: HomeWidget) =>
    w.kind === "builtin" ? (
      <BuiltinWidget
        id={w.ref as BuiltinHomeWidget}
        data={data}
        canCreate={Boolean(lookups)}
        onCreate={setCreating}
        onChanged={refresh}
      />
    ) : w.kind === "report" ? (
      <ReportWidget id={w.ref} />
    ) : (
      <DashboardWidgetInline id={w.ref} />
    );

  const canEditHome = can("home") && canWrite.length > 0;

  return (
    <div className="mb-8 space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <FilterSelect
          label={t("entityFilter")}
          value={entityId}
          onChange={(value) => setFilters({ entity_id: value })}
          options={data?.entities ?? []}
          allLabel={t("allEntities")}
        />
        {entityId ? <p className="text-xs text-muted-foreground">{t("entityHint")}</p> : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {!editing && layout?.source === "user" && canWrite.includes("user") ? (
            <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => void reset()}>
              <RotateCcw aria-hidden /> {tEdit("reset")}
            </Button>
          ) : null}
          {!editing && canEditHome ? (
            <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={startEdit} disabled={layout === undefined}>
              <LayoutGrid aria-hidden /> {tEdit("start")}
            </Button>
          ) : null}
        </div>
      </div>

      {editing ? (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border/60 bg-white p-3">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground sm:max-w-sm">
            {tEdit("addWidget")}
            <select value={pick} onChange={(e) => setPick(e.target.value)} className={selectClass}>
              <option value="">{tEdit("select")}</option>
              {builtins.length > 0 ? (
                <optgroup label={tEdit("groupBuiltin")}>
                  {builtins.map((b) => (
                    <option key={b.id} value={`builtin:${b.id}`}>
                      {tHome(b.titleKey)}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {reportOptions.length > 0 ? (
                <optgroup label={tEdit("groupReports")}>
                  {reportOptions.map(([id, name]) => (
                    <option key={id} value={`report:${id}`}>
                      {name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {dashboardOptions.length > 0 ? (
                <optgroup label={tEdit("groupDashboards")}>
                  {dashboardOptions.map(([id, name]) => (
                    <option key={id} value={`dashboard:${id}`}>
                      {name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </select>
          </label>
          <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={add} disabled={!pick}>
            <Plus aria-hidden /> {tEdit("add")}
          </Button>
          <div className="ml-auto flex flex-wrap items-end gap-2">
            {canWrite.length > 0 ? (
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                {tEdit("saveAs")}
                <select value={scope} onChange={(e) => void changeScope(e.target.value as HomeLayoutScope)} className={selectClass}>
                  {canWrite.map((s) => (
                    <option key={s} value={s}>
                      {tEdit(`scopes.${s}`)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => setDraft(null)} disabled={saving}>
              {tEdit("cancel")}
            </Button>
            <Button type="button" size="sm" className="rounded-full" onClick={() => void save()} disabled={saving || canWrite.length === 0}>
              {tEdit("save")}
            </Button>
          </div>
        </div>
      ) : null}
      {editing ? <p className="text-xs text-muted-foreground">{tEdit("hint")}</p> : null}
      <LiveAnnouncer message={announce} />

      {failed && !data ? <ErrorState message={t("failed")} onRetry={refresh} /> : null}

      {layout === undefined ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {list.map((w, i) =>
            editing ? (
              <WidgetFrame
                key={w.id}
                label={labelOf(w)}
                index={i}
                count={list.length}
                size={w.size}
                onMove={(d) => move(i, d)}
                onSize={(size) => update((d) => patchWidgetById(d, w.id, { size }))}
                onRemove={() => {
                  setAnnounce(tEdit("removed", { name: labelOf(w) }));
                  update((d) => removeWidgetById(d, w.id));
                }}
              >
                {w.kind === "builtin" ? (
                  renderWidget(w)
                ) : (
                  <div className="rounded-b-xl border border-t-0 border-border/60 bg-white p-4 text-sm text-oboya-blue-dark">{labelOf(w)}</div>
                )}
              </WidgetFrame>
            ) : (
              <div key={w.id} className={cn("min-w-0", WIDGET_SPAN[w.size])}>
                {renderWidget(w)}
              </div>
            ),
          )}
        </div>
      )}

      {lookups && creating ? (
        <RecordFormDrawer object={creating} open onClose={() => setCreating(null)} lookups={lookups} />
      ) : null}
    </div>
  );
}
