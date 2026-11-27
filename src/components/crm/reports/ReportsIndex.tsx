"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { BarChart3, FolderPlus, LayoutDashboard, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, useApiErrorMessage } from "@/components/crm/common/api";
import { FilterTabs } from "@/components/crm/common/FilterBar";
import { EmptyState } from "@/components/crm/common/states";
import { useUrlFilters } from "@/components/crm/common/use-url-filters";
import { DataTable, type DataTableColumn } from "@/components/crm/data-table/DataTable";
import { FormDrawer } from "@/components/crm/forms/FormDrawer";
import { CrmPageHeader } from "@/components/crm/layout/CrmPageHeader";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCrm } from "@/contexts/CrmContext";
import {
  REPORTS_API,
  type DashboardDto,
  type DashboardListResponse,
  type FolderDto,
  type FolderListResponse,
  type ReportListResponse,
  type ReportSummary,
} from "@/lib/crm/reports/api-contract";
import { REPORT_VISIBILITIES, type ReportVisibility } from "@/lib/crm/reports/definition";
import { canPublish, publishableTeamIds, type PublishActor } from "@/lib/crm/reports/sharing";
import { cn } from "@/lib/utils";

export type TeamOption = { id: string; name: string; managerId: string | null };
type DashboardRow = Omit<DashboardDto, "widgets">;
type Editing =
  | { kind: "folder"; folder: FolderDto | null }
  | { kind: "dashboard" }
  | { kind: "delete"; what: "folder" | "report" | "dashboard"; id: string; name: string };

const fieldClass = "h-9 w-full rounded-md border border-border/70 bg-white px-2 text-sm text-oboya-blue-dark";
const VIS_ORDER: ReportVisibility[] = ["private", "team", "public"];

export function ReportsIndex({
  teams,
  isAdmin,
  managedTeamIds,
}: {
  teams: TeamOption[];
  isAdmin: boolean;
  managedTeamIds: string[];
}) {
  const t = useTranslations("reports.index");
  const format = useFormatter();
  const router = useRouter();
  const errorMessage = useApiErrorMessage();
  const { can, user } = useCrm();
  const { filters, setFilters } = useUrlFilters({ tab: "reports", folder: "mine" });
  const tab = filters.tab === "dashboards" ? "dashboards" : "reports";

  const [folders, setFolders] = useState<FolderDto[]>([]);
  const [reports, setReports] = useState<ReportSummary[] | null>(null);
  const [dashboards, setDashboards] = useState<DashboardRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);

  const actor: PublishActor = useMemo(() => ({ isAdmin, managedTeamIds }), [isAdmin, managedTeamIds]);
  const load = useCallback(async () => {
    try {
      const [f, r, d] = await Promise.all([
        apiFetch<FolderListResponse>(REPORTS_API.folders, { quiet: true }),
        apiFetch<ReportListResponse>(REPORTS_API.reports, { quiet: true }),
        apiFetch<DashboardListResponse>(REPORTS_API.dashboards, { quiet: true }),
      ]);
      setFolders(f.folders);
      setReports(r.reports);
      setDashboards(d.dashboards);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [errorMessage]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    void load();
  }, [load]);

  const folderId = filters.folder;
  const selectedFolder = folders.find((f) => f.id === folderId) ?? null;
  const activeFolder = selectedFolder ? folderId : "mine";
  const folderName = (id: string | null) => folders.find((f) => f.id === id)?.name ?? t("noFolder");

  const visibleReports = (reports ?? []).filter((r) =>
    activeFolder === "mine" ? r.ownerId === user.id : r.folderId === activeFolder,
  );

  const date = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });
  const canDelete = can("reports", "delete");
  const confirmDelete = (what: "folder" | "report" | "dashboard", id: string, name: string) =>
    setEditing({ kind: "delete", what, id, name });

  const rowActions = (what: "report" | "dashboard", row: { id: string; name: string; canEdit: boolean }) =>
    canDelete && row.canEdit ? (
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t("deleteItem", { name: row.name })}
        onClick={() => confirmDelete(what, row.id, row.name)}
      >
        <Trash2 aria-hidden />
      </Button>
    ) : null;

  const reportColumns: DataTableColumn<ReportSummary>[] = [
    {
      key: "name",
      header: t("columns.name"),
      sortable: true,
      cell: (r) => (
        <Link href={`/reports/${r.id}`} className="font-medium text-oboya-blue-dark hover:underline">
          {r.name}
        </Link>
      ),
    },
    { key: "object", header: t("columns.object"), cell: (r) => t(`objects.${r.object}`), className: "hidden md:table-cell" },
    { key: "folder", header: t("columns.folder"), cell: (r) => folderName(r.folderId), className: "hidden md:table-cell" },
    { key: "owner", header: t("columns.owner"), cell: (r) => r.ownerName ?? "—", className: "hidden lg:table-cell" },
    {
      key: "updatedAt",
      header: t("columns.updated"),
      sortable: true,
      sortValue: (r) => r.updatedAt,
      cell: (r) => date(r.updatedAt),
    },
    { key: "actions", header: "", cell: (r) => rowActions("report", r), className: "w-10" },
  ];
  const dashboardColumns: DataTableColumn<DashboardRow>[] = [
    {
      key: "name",
      header: t("columns.name"),
      sortable: true,
      cell: (d) => (
        <Link href={`/reports/dashboards/${d.id}`} className="font-medium text-oboya-blue-dark hover:underline">
          {d.name}
        </Link>
      ),
    },
    { key: "visibility", header: t("columns.visibility"), cell: (d) => t(`visibility.${d.visibility}`), className: "hidden md:table-cell" },
    { key: "owner", header: t("columns.owner"), cell: (d) => d.ownerName ?? "—", className: "hidden lg:table-cell" },
    {
      key: "updatedAt",
      header: t("columns.updated"),
      sortable: true,
      sortValue: (d) => d.updatedAt,
      cell: (d) => date(d.updatedAt),
    },
    { key: "actions", header: "", cell: (d) => rowActions("dashboard", d), className: "w-10" },
  ];

  const folderGroups = VIS_ORDER.map((v) => ({ v, items: folders.filter((f) => f.visibility === v) })).filter((g) => g.items.length > 0);
  const canCreate = can("reports", "create");

  return (
    <>
      <CrmPageHeader
        title={t("title")}
        description={t("description")}
        actions={
          canCreate ? (
            <>
              {tab === "dashboards" ? (
                <Button size="sm" className="rounded-full" onClick={() => setEditing({ kind: "dashboard" })}>
                  <Plus aria-hidden /> {t("newDashboard")}
                </Button>
              ) : (
                <Link href="/reports/new" className={cn(buttonVariants({ size: "sm" }), "rounded-full")}>
                  <Plus aria-hidden /> {t("newReport")}
                </Link>
              )}
            </>
          ) : null
        }
      />
      <FilterTabs
        className="mb-4"
        value={tab}
        onChange={(v) => setFilters({ tab: v })}
        options={[
          { value: "reports", label: t("tabs.reports") },
          { value: "dashboards", label: t("tabs.dashboards") },
        ]}
      />

      {tab === "reports" ? (
        <div className="grid gap-4 md:grid-cols-[14rem_minmax(0,1fr)]">
          <div className="md:hidden">
            <Label htmlFor="reports-folder" className="mb-1 text-xs text-muted-foreground">
              {t("folders")}
            </Label>
            <select id="reports-folder" value={activeFolder} onChange={(e) => setFilters({ folder: e.target.value })} className={fieldClass}>
              <option value="mine">{t("myReports")}</option>
              {folderGroups.map((g) => (
                <optgroup key={g.v} label={t(`visibilityGroup.${g.v}`)}>
                  {g.items.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <nav aria-label={t("folders")} className="hidden space-y-4 md:block">
            <FolderLink active={activeFolder === "mine"} onClick={() => setFilters({ folder: "mine" })}>
              {t("myReports")}
            </FolderLink>
            {folderGroups.map((g) => (
              <div key={g.v}>
                <p className="mb-1 px-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                  {t(`visibilityGroup.${g.v}`)}
                </p>
                {g.items.map((f) => (
                  <FolderLink key={f.id} active={activeFolder === f.id} onClick={() => setFilters({ folder: f.id })}>
                    {f.name}
                  </FolderLink>
                ))}
              </div>
            ))}
          </nav>
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-base font-semibold text-oboya-blue-dark">
                {selectedFolder ? selectedFolder.name : t("myReports")}
              </h2>
              <div className="flex flex-wrap gap-2">
                {selectedFolder?.canEdit && can("reports", "edit") ? (
                  <Button variant="outline" size="sm" className="rounded-full" onClick={() => setEditing({ kind: "folder", folder: selectedFolder })}>
                    <Pencil aria-hidden /> {t("renameFolder")}
                  </Button>
                ) : null}
                {selectedFolder?.canEdit && canDelete ? (
                  <Button variant="outline" size="sm" className="rounded-full" onClick={() => confirmDelete("folder", selectedFolder.id, selectedFolder.name)}>
                    <Trash2 aria-hidden /> {t("deleteFolder")}
                  </Button>
                ) : null}
                {canCreate ? (
                  <Button variant="outline" size="sm" className="rounded-full" onClick={() => setEditing({ kind: "folder", folder: null })}>
                    <FolderPlus aria-hidden /> {t("newFolder")}
                  </Button>
                ) : null}
              </div>
            </div>
            <DataTable
              data={visibleReports}
              columns={reportColumns}
              getRowId={(r) => r.id}
              searchKey="name"
              searchPlaceholder={t("searchReports")}
              loading={reports === null && !error}
              error={error}
              onRetry={() => void load()}
              emptyState={<EmptyState icon={BarChart3} title={t("emptyReports")} description={canCreate ? t("emptyReportsHint") : undefined} />}
            />
          </div>
        </div>
      ) : (
        <DataTable
          data={dashboards ?? []}
          columns={dashboardColumns}
          getRowId={(d) => d.id}
          searchKey="name"
          searchPlaceholder={t("searchDashboards")}
          loading={dashboards === null && !error}
          error={error}
          onRetry={() => void load()}
          emptyState={<EmptyState icon={LayoutDashboard} title={t("emptyDashboards")} description={canCreate ? t("emptyDashboardsHint") : undefined} />}
        />
      )}

      {editing?.kind === "folder" ? (
        <ShareDrawer
          key={editing.folder?.id ?? "new-folder"}
          title={editing.folder ? t("renameFolder") : t("newFolder")}
          initial={editing.folder}
          actor={actor}
          teams={teams}
          onClose={() => setEditing(null)}
          onSubmit={async (v) => {
            if (editing.folder) await apiFetch(REPORTS_API.folder(editing.folder.id), { method: "PATCH", body: JSON.stringify(v) });
            else {
              const res = await apiFetch<{ folder: FolderDto }>(REPORTS_API.folders, { method: "POST", body: JSON.stringify(v) });
              setFilters({ folder: res.folder.id });
            }
            toast.success(t("saved"));
            setEditing(null);
            await load();
          }}
        />
      ) : null}
      {editing?.kind === "dashboard" ? (
        <ShareDrawer
          title={t("newDashboard")}
          initial={null}
          withDescription
          actor={actor}
          teams={teams}
          onClose={() => setEditing(null)}
          onSubmit={async (v) => {
            const res = await apiFetch<{ dashboard: DashboardDto }>(REPORTS_API.dashboards, {
              method: "POST",
              body: JSON.stringify({ ...v, widgets: [] }),
            });
            router.push(`/reports/dashboards/${res.dashboard.id}`);
          }}
        />
      ) : null}
      {editing?.kind === "delete" ? (
        <FormDrawer
          open
          width="sm"
          onClose={() => setEditing(null)}
          title={t("deleteTitle", { name: editing.name })}
          description={t(`deleteBody.${editing.what}`)}
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="outline" className="rounded-full" onClick={() => setEditing(null)}>
                {t("cancel")}
              </Button>
              <Button
                className="rounded-full bg-oboya-orange text-white hover:bg-oboya-orange/90"
                onClick={async () => {
                  const url =
                    editing.what === "folder"
                      ? REPORTS_API.folder(editing.id)
                      : editing.what === "report"
                        ? REPORTS_API.report(editing.id)
                        : REPORTS_API.dashboard(editing.id);
                  try {
                    await apiFetch(url, { method: "DELETE" });
                    toast.success(t("deleted"));
                    if (editing.what === "folder") setFilters({ folder: "mine" });
                    setEditing(null);
                    await load();
                  } catch (e) {
                    toast.error(errorMessage(e));
                  }
                }}
              >
                {t("delete")}
              </Button>
            </div>
          }
        >
          <p className="text-sm text-muted-foreground">{t("deleteHint")}</p>
        </FormDrawer>
      ) : null}
    </>
  );
}

function FolderLink({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={cn(
        "block min-h-9 w-full truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        active ? "bg-oboya-blue/10 font-medium text-oboya-blue" : "text-oboya-blue-dark hover:bg-oboya-soft-white",
      )}
    >
      {children}
    </button>
  );
}

type ShareValues = { name: string; description?: string; visibility: ReportVisibility; teamId: string | null };

/** Folder / dashboard form. Visibility options depend on `canPublish`; team needs a team. */
function ShareDrawer({
  title,
  initial,
  withDescription,
  actor,
  teams,
  onClose,
  onSubmit,
}: {
  title: string;
  initial: FolderDto | null;
  withDescription?: boolean;
  actor: PublishActor;
  teams: TeamOption[];
  onClose: () => void;
  onSubmit: (values: ShareValues) => Promise<void>;
}) {
  const t = useTranslations("reports.index");
  const errorMessage = useApiErrorMessage();
  const publishableIds = publishableTeamIds(actor, teams.map((tm) => tm.id));
  const publishableTeams = teams.filter((tm) => publishableIds.includes(tm.id));
  const options = REPORT_VISIBILITIES.filter((v) =>
    v === "team" ? publishableTeams.length > 0 : v === "public" ? canPublish(actor, "public") : true,
  );
  // An existing visibility the viewer cannot choose stays selectable so the form does not silently change it.
  const choices = initial && !options.includes(initial.visibility) ? [...options, initial.visibility] : options;
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<ReportVisibility>(initial?.visibility ?? "private");
  const { user } = useCrm();
  // Default to the viewer's own team when they may publish to it; managers of
  // several teams would otherwise get whichever team sorts first.
  const ownTeam = publishableTeams.find((tm) => tm.id === user?.teamId)?.id;
  const [teamId, setTeamId] = useState(initial?.teamId ?? ownTeam ?? publishableTeams[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const needsTeam = visibility === "team";
  const valid = name.trim().length > 0 && (!needsTeam || teamId);

  return (
    <FormDrawer
      open
      width="sm"
      onClose={onClose}
      title={title}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="rounded-full" onClick={onClose} disabled={saving}>
            {t("cancel")}
          </Button>
          <Button
            className="rounded-full"
            disabled={!valid || saving}
            onClick={async () => {
              setSaving(true);
              try {
                await onSubmit({
                  name: name.trim(),
                  ...(withDescription ? { description: description.trim() } : {}),
                  visibility,
                  teamId: needsTeam ? teamId : null,
                });
              } catch (e) {
                toast.error(errorMessage(e));
                setSaving(false);
              }
            }}
          >
            {t("save")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="share-name">{t("form.name")}</Label>
          <Input id="share-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        {withDescription ? (
          <div className="space-y-1.5">
            <Label htmlFor="share-description">{t("form.description")}</Label>
            <Input id="share-description" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="share-visibility">{t("form.visibility")}</Label>
          <select id="share-visibility" value={visibility} onChange={(e) => setVisibility(e.target.value as ReportVisibility)} className={fieldClass}>
            {choices.map((v) => (
              <option key={v} value={v}>
                {t(`visibility.${v}`)}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">{t(`visibilityHint.${visibility}`)}</p>
          {!actor.isAdmin && actor.managedTeamIds.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("form.managersOnly")}</p>
          ) : null}
        </div>
        {needsTeam ? (
          <div className="space-y-1.5">
            <Label htmlFor="share-team">{t("form.team")}</Label>
            <select id="share-team" value={teamId} onChange={(e) => setTeamId(e.target.value)} className={fieldClass}>
              {(initial?.teamId && !publishableTeams.some((tm) => tm.id === initial.teamId)
                ? [...publishableTeams, ...teams.filter((tm) => tm.id === initial.teamId)]
                : publishableTeams
              ).map((tm) => (
                <option key={tm.id} value={tm.id}>
                  {tm.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
    </FormDrawer>
  );
}
