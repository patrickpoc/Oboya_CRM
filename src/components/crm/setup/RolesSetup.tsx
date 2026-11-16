"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useCrm } from "@/contexts/CrmContext";
import { CrmPageHeader } from "@/components/crm/layout/CrmPageHeader";
import { DataTable, type DataTableColumn } from "@/components/crm/data-table/DataTable";
import { FormDrawer } from "@/components/crm/forms/FormDrawer";
import { FilterTabs } from "@/components/crm/common/FilterBar";
import { StatusPill } from "@/components/crm/common/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { VisibilityScope } from "@/lib/crm/types";
import type { SetupRole, SetupTeam } from "@/lib/crm/setup/rows";
import { slugifyPicklistValue } from "@/lib/crm/setup/picklists";
import { Field, apiFetch, selectClass, useErrorMessage, useSetupData } from "./shared";

type RolesPayload = {
  roles: SetupRole[];
  teams: SetupTeam[];
  users: { id: string; fullName: string; status: string }[];
};

type RoleDraft = {
  isNew: boolean;
  id: string;
  label: string;
  description: string;
  visibilityScope: VisibilityScope;
  canWrite: boolean;
  active: boolean;
  baseRole: string;
  system: boolean;
};

type TeamDraft = { id?: string; name: string; description: string; managerId: string; active: boolean };

const SCOPES: VisibilityScope[] = ["own", "team", "all"];

function roleId(label: string) {
  const slug = slugifyPicklistValue(label).replace(/^[^a-z]+/, "");
  return slug.length >= 2 ? slug.slice(0, 40) : "";
}

export function RolesSetup() {
  const t = useTranslations("setup.roles");
  const tc = useTranslations("setup.common");
  const errorMessage = useErrorMessage();
  const { can } = useCrm();
  const { data, error, loading, reload } = useSetupData<RolesPayload>("/api/crm/roles");
  const [tab, setTab] = useState<"roles" | "teams">("roles");
  const [roleDraft, setRoleDraft] = useState<RoleDraft | null>(null);
  const [teamDraft, setTeamDraft] = useState<TeamDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const roles = data?.roles ?? [];
  const teams = data?.teams ?? [];
  const users = data?.users ?? [];
  const canCreate = can("setup_roles", "create");
  const canEdit = can("setup_roles", "edit");
  const canDelete = can("setup_roles", "delete");

  const run = async (action: () => Promise<unknown>, success: string) => {
    setSaving(true);
    try {
      await action();
      toast.success(success);
      await reload();
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saveRole = async () => {
    if (!roleDraft) return;
    const d = roleDraft;
    const ok = await run(
      () =>
        d.isNew
          ? apiFetch("/api/crm/roles", {
              method: "POST",
              body: JSON.stringify({
                id: d.id,
                label: d.label.trim(),
                description: d.description.trim() || null,
                visibilityScope: d.visibilityScope,
                canWrite: d.canWrite,
                ...(d.baseRole ? { baseRole: d.baseRole } : {}),
              }),
            })
          : apiFetch(`/api/crm/roles/${d.id}`, {
              method: "PATCH",
              body: JSON.stringify({
                label: d.label.trim(),
                description: d.description.trim() || null,
                ...(d.id === "super_admin"
                  ? {}
                  : { visibilityScope: d.visibilityScope, canWrite: d.canWrite, active: d.active }),
              }),
            }),
      d.isNew ? t("created") : t("updated")
    );
    if (ok) setRoleDraft(null);
  };

  const deleteRole = async (role: SetupRole) => {
    if (!window.confirm(t("deleteConfirm", { label: role.label }))) return;
    await run(() => apiFetch(`/api/crm/roles/${role.id}`, { method: "DELETE" }), t("deleted"));
  };

  const saveTeam = async () => {
    if (!teamDraft) return;
    const d = teamDraft;
    const body = JSON.stringify({
      name: d.name.trim(),
      description: d.description.trim() || null,
      managerId: d.managerId || null,
      active: d.active,
    });
    const ok = await run(
      () =>
        d.id
          ? apiFetch(`/api/crm/roles/teams/${d.id}`, { method: "PATCH", body })
          : apiFetch("/api/crm/roles/teams", { method: "POST", body }),
      d.id ? t("teamUpdated") : t("teamCreated")
    );
    if (ok) setTeamDraft(null);
  };

  const deleteTeam = async (team: SetupTeam) => {
    if (!window.confirm(t("teamDeleteConfirm", { name: team.name }))) return;
    await run(() => apiFetch(`/api/crm/roles/teams/${team.id}`, { method: "DELETE" }), t("teamDeleted"));
  };

  const editRole = (r: SetupRole) =>
    setRoleDraft({
      isNew: false,
      id: r.id,
      label: r.label,
      description: r.description ?? "",
      visibilityScope: r.visibilityScope,
      canWrite: r.canWrite,
      active: r.active,
      baseRole: "",
      system: r.system,
    });

  const editTeam = (team: SetupTeam) =>
    setTeamDraft({
      id: team.id,
      name: team.name,
      description: team.description ?? "",
      managerId: team.managerId ?? "",
      active: team.active,
    });

  const roleColumns: DataTableColumn<SetupRole>[] = [
    {
      key: "label",
      header: t("label"),
      sortable: true,
      cell: (r) => (
        <span>
          <span className="flex items-center gap-2 font-medium">
            {r.label}
            {r.system ? <StatusPill size="xs">{t("system")}</StatusPill> : null}
            {!r.active ? <StatusPill size="xs" tone="muted">{t("inactive")}</StatusPill> : null}
          </span>
          <span className="font-mono text-[11px] text-muted-foreground">{r.id}</span>
        </span>
      ),
    },
    { key: "scope", header: t("scope"), cell: (r) => t(`scopes.${r.visibilityScope}`) },
    {
      key: "canWrite",
      header: t("canWrite"),
      cell: (r) => (
        <StatusPill tone={r.canWrite ? "success" : "muted"}>{r.canWrite ? t("write") : t("readOnly")}</StatusPill>
      ),
    },
    { key: "users", header: t("users"), sortable: true, sortValue: (r) => r.userCount ?? 0, cell: (r) => r.userCount ?? 0 },
    {
      key: "actions",
      header: "",
      className: "w-20 text-right",
      cell: (r) => (
        <span className="inline-flex gap-1">
          {canEdit ? (
            <button type="button" onClick={() => editRole(r)} aria-label={t("editNamed", { label: r.label })} className="rounded p-1.5 hover:bg-muted">
              <Pencil className="size-3.5" />
            </button>
          ) : null}
          {canDelete && !r.system ? (
            <button
              type="button"
              onClick={() => void deleteRole(r)}
              aria-label={t("deleteNamed", { label: r.label })}
              className="rounded p-1.5 text-oboya-orange hover:bg-muted"
            >
              <Trash2 className="size-3.5" />
            </button>
          ) : null}
        </span>
      ),
    },
  ];

  const managerName = (id: string | null) => users.find((u) => u.id === id)?.fullName ?? "—";
  const teamColumns: DataTableColumn<SetupTeam>[] = [
    {
      key: "name",
      header: t("teamName"),
      sortable: true,
      cell: (team) => (
        <span className="flex items-center gap-2 font-medium">
          {team.name}
          {!team.active ? <StatusPill size="xs" tone="muted">{t("inactive")}</StatusPill> : null}
        </span>
      ),
    },
    { key: "manager", header: t("manager"), sortable: true, sortValue: (x) => managerName(x.managerId), cell: (x) => managerName(x.managerId) },
    { key: "members", header: t("members"), cell: (x) => x.memberCount ?? 0 },
    {
      key: "actions",
      header: "",
      className: "w-20 text-right",
      cell: (team) => (
        <span className="inline-flex gap-1">
          {canEdit ? (
            <button type="button" onClick={() => editTeam(team)} aria-label={t("editNamed", { label: team.name })} className="rounded p-1.5 hover:bg-muted">
              <Pencil className="size-3.5" />
            </button>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              onClick={() => void deleteTeam(team)}
              aria-label={t("deleteNamed", { label: team.name })}
              className="rounded p-1.5 text-oboya-orange hover:bg-muted"
            >
              <Trash2 className="size-3.5" />
            </button>
          ) : null}
        </span>
      ),
    },
  ];

  const footer = (onSave: () => void, disabled: boolean, onCancel: () => void) => (
    <div className="flex justify-end gap-2">
      <Button variant="ghost" className="rounded-full" onClick={onCancel}>
        {tc("cancel")}
      </Button>
      <Button className="rounded-full bg-oboya-green text-white hover:bg-oboya-green/90" disabled={saving || disabled} onClick={onSave}>
        {saving ? tc("saving") : tc("save")}
      </Button>
    </div>
  );

  return (
    <>
      <CrmPageHeader
        title={t("title")}
        description={t("description")}
        actions={
          canCreate ? (
            <Button
              className="gap-1.5 rounded-full bg-oboya-green text-white hover:bg-oboya-green/90"
              onClick={() =>
                tab === "roles"
                  ? setRoleDraft({
                      isNew: true,
                      id: "",
                      label: "",
                      description: "",
                      visibilityScope: "own",
                      canWrite: true,
                      active: true,
                      baseRole: "sales_rep",
                      system: false,
                    })
                  : setTeamDraft({ name: "", description: "", managerId: "", active: true })
              }
            >
              <Plus className="size-4" />
              {tab === "roles" ? t("addRole") : t("addTeam")}
            </Button>
          ) : null
        }
      />
      <FilterTabs
        className="mb-4"
        value={tab}
        onChange={(v) => setTab(v as "roles" | "teams")}
        options={[
          { value: "roles", label: t("tabRoles"), count: roles.length },
          { value: "teams", label: t("tabTeams"), count: teams.length },
        ]}
      />
      {tab === "roles" ? (
        <DataTable
          data={roles}
          columns={roleColumns}
          getRowId={(r) => r.id}
          loading={loading && !data}
          error={error && !data ? errorMessage(error) : null}
          onRetry={() => void reload()}
          pageSize={50}
        />
      ) : (
        <DataTable
          data={teams}
          columns={teamColumns}
          getRowId={(x) => x.id}
          loading={loading && !data}
          error={error && !data ? errorMessage(error) : null}
          onRetry={() => void reload()}
          emptyMessage={t("noTeams")}
          pageSize={50}
        />
      )}

      <FormDrawer
        open={roleDraft !== null}
        onClose={() => setRoleDraft(null)}
        title={roleDraft?.isNew ? t("newRole") : (roleDraft?.label ?? "")}
        description={roleDraft?.isNew ? t("newRoleHint") : roleDraft?.id}
        footer={footer(
          () => void saveRole(),
          !roleDraft?.label.trim() || (roleDraft?.isNew === true && !/^[a-z][a-z0-9_]{1,39}$/.test(roleDraft.id)),
          () => setRoleDraft(null)
        )}
      >
        {roleDraft ? (
          <div className="space-y-4">
            <Field label={t("label")} htmlFor="role-label">
              <Input
                id="role-label"
                value={roleDraft.label}
                onChange={(e) =>
                  setRoleDraft({
                    ...roleDraft,
                    label: e.target.value,
                    ...(roleDraft.isNew ? { id: roleId(e.target.value) } : {}),
                  })
                }
              />
            </Field>
            {roleDraft.isNew ? (
              <Field label={t("roleId")} htmlFor="role-id" hint={t("roleIdHint")}>
                <Input
                  id="role-id"
                  className="font-mono"
                  value={roleDraft.id}
                  onChange={(e) => setRoleDraft({ ...roleDraft, id: e.target.value.toLowerCase() })}
                />
              </Field>
            ) : null}
            <Field label={t("roleDescription")} htmlFor="role-description">
              <Textarea
                id="role-description"
                value={roleDraft.description}
                onChange={(e) => setRoleDraft({ ...roleDraft, description: e.target.value })}
              />
            </Field>
            {roleDraft.id === "super_admin" ? (
              <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">{t("superAdminLocked")}</p>
            ) : (
              <>
                <fieldset className="space-y-2">
                  <legend className="mb-1 text-sm font-medium">{t("scope")}</legend>
                  {SCOPES.map((scope) => (
                    <label key={scope} className="flex items-start gap-2 rounded-lg border border-border/60 px-3 py-2">
                      <input
                        type="radio"
                        name="role-scope"
                        className="mt-1 accent-[var(--oboya-blue)]"
                        checked={roleDraft.visibilityScope === scope}
                        onChange={() => setRoleDraft({ ...roleDraft, visibilityScope: scope })}
                      />
                      <span>
                        <span className="block text-sm font-medium text-oboya-blue-dark">{t(`scopes.${scope}`)}</span>
                        <span className="block text-xs text-muted-foreground">{t(`scopeHints.${scope}`)}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <label className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5">
                  <span>
                    <span className="block text-sm font-medium text-oboya-blue-dark">{t("canWrite")}</span>
                    <span className="block text-xs text-muted-foreground">{t("canWriteHint")}</span>
                  </span>
                  <Switch checked={roleDraft.canWrite} onCheckedChange={(canWrite) => setRoleDraft({ ...roleDraft, canWrite })} />
                </label>
                {roleDraft.isNew ? (
                  <Field label={t("baseRole")} htmlFor="role-base" hint={t("baseRoleHint")}>
                    <select
                      id="role-base"
                      className={selectClass}
                      value={roleDraft.baseRole}
                      onChange={(e) => setRoleDraft({ ...roleDraft, baseRole: e.target.value })}
                    >
                      <option value="">{t("noBaseRole")}</option>
                      {roles
                        .filter((r) => r.id !== "super_admin")
                        .map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.label}
                          </option>
                        ))}
                    </select>
                  </Field>
                ) : (
                  <label className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5">
                    <span className="text-sm font-medium text-oboya-blue-dark">{t("active")}</span>
                    <Switch checked={roleDraft.active} onCheckedChange={(active) => setRoleDraft({ ...roleDraft, active })} />
                  </label>
                )}
              </>
            )}
          </div>
        ) : null}
      </FormDrawer>

      <FormDrawer
        open={teamDraft !== null}
        onClose={() => setTeamDraft(null)}
        title={teamDraft?.id ? teamDraft.name : t("newTeam")}
        footer={footer(() => void saveTeam(), !teamDraft?.name.trim(), () => setTeamDraft(null))}
      >
        {teamDraft ? (
          <div className="space-y-4">
            <Field label={t("teamName")} htmlFor="team-name">
              <Input id="team-name" value={teamDraft.name} onChange={(e) => setTeamDraft({ ...teamDraft, name: e.target.value })} />
            </Field>
            <Field label={t("manager")} htmlFor="team-manager" hint={t("managerHint")}>
              <select
                id="team-manager"
                className={selectClass}
                value={teamDraft.managerId}
                onChange={(e) => setTeamDraft({ ...teamDraft, managerId: e.target.value })}
              >
                <option value="">{t("noManager")}</option>
                {users
                  .filter((u) => u.status === "active" || u.id === teamDraft.managerId)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label={t("roleDescription")} htmlFor="team-description">
              <Textarea
                id="team-description"
                value={teamDraft.description}
                onChange={(e) => setTeamDraft({ ...teamDraft, description: e.target.value })}
              />
            </Field>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5">
              <span className="text-sm font-medium text-oboya-blue-dark">{t("active")}</span>
              <Switch checked={teamDraft.active} onCheckedChange={(active) => setTeamDraft({ ...teamDraft, active })} />
            </label>
          </div>
        ) : null}
      </FormDrawer>
    </>
  );
}
