"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Copy, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { useCrm } from "@/contexts/CrmContext";
import { CrmPageHeader } from "@/components/crm/layout/CrmPageHeader";
import { DataTable, type DataTableColumn } from "@/components/crm/data-table/DataTable";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormDrawer } from "@/components/crm/forms/FormDrawer";
import { EntityAvatar } from "@/components/crm/common/EntityAvatar";
import { FilterBar, FilterSelect, SearchInput } from "@/components/crm/common/FilterBar";
import { StatusPill } from "@/components/crm/common/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { localeLabels, locales } from "@/i18n/routing";
import type { AccessMatrix } from "@/lib/crm/permissions/access-types";
import type { PermissionOverrides } from "@/lib/crm/types";
import { countOverrides, normalizeOverrides } from "@/lib/crm/setup/matrix";
import type {
  CasdoorAccessRequestView,
  SetupRole,
  SetupTeam,
  SetupUser,
} from "@/lib/crm/setup/rows";
import { canAssignRole, checkUserUpdate } from "@/lib/crm/setup/users";
import { UserOverridesEditor } from "./UserOverridesEditor";
import { Field, apiFetch, selectClass, useErrorMessage, useSetupData } from "./shared";

type UsersPayload = {
  users: SetupUser[];
  roles: SetupRole[];
  teams: SetupTeam[];
  matrix: AccessMatrix;
  casdoorRequests: CasdoorAccessRequestView[];
};

type Draft = {
  id?: string;
  email: string;
  fullName: string;
  title: string;
  phone: string;
  role: string;
  teamId: string;
  status: "active" | "disabled";
  locale: string;
  receivesInbound: boolean;
  permissionOverrides: PermissionOverrides;
};

const emptyDraft = (role: string): Draft => ({
  email: "",
  fullName: "",
  title: "",
  phone: "",
  role,
  teamId: "",
  status: "active",
  locale: "en",
  receivesInbound: false,
  permissionOverrides: {},
});

export function UsersSetup() {
  const t = useTranslations("setup.users");
  const tc = useTranslations("setup.common");
  const errorMessage = useErrorMessage();
  const { user: actor, can } = useCrm();
  const { data, error, loading, reload } = useSetupData<UsersPayload>("/api/crm/users");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState<{ email: string; value: string } | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [reviewTarget, setReviewTarget] = useState<CasdoorAccessRequestView | null>(null);
  const [reviewRole, setReviewRole] = useState("sales_rep");
  const [reviewTeamId, setReviewTeamId] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [reviewing, setReviewing] = useState(false);

  const roles = useMemo(() => data?.roles ?? [], [data]);
  const teams = useMemo(() => data?.teams ?? [], [data]);
  const users = useMemo(() => data?.users ?? [], [data]);
  const roleLabel = (id: string) => roles.find((r) => r.id === id)?.label ?? id;
  const teamName = (id: string | null) => teams.find((x) => x.id === id)?.name ?? "—";
  const assignable = roles.filter((r) => r.active && canAssignRole(actor.role, r.id));
  const activeSuperAdminIds = users.filter((u) => u.role === "super_admin" && u.status === "active").map((u) => u.id);
  const isNew = draft !== null && !draft.id;
  const isSelf = draft?.id === actor.id;
  const original = draft?.id ? users.find((u) => u.id === draft.id) : undefined;

  const guardError =
    draft && original
      ? checkUserUpdate({
          actor: { id: actor.id, role: actor.role },
          target: original,
          patch: { role: draft.role, status: draft.status },
          activeSuperAdminIds,
        })
      : null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter(
      (u) =>
        (!q || u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)) &&
        (!statusFilter || u.status === statusFilter) &&
        (!roleFilter || u.role === roleFilter)
    );
  }, [users, search, statusFilter, roleFilter]);

  const pendingRequests = useMemo(
    () => (data?.casdoorRequests ?? []).filter((request) => request.status === "pending"),
    [data]
  );

  const openReview = (request: CasdoorAccessRequestView) => {
    setReviewTarget(request);
    setReviewRole(assignable.find((r) => r.id === "sales_rep")?.id ?? assignable[0]?.id ?? "sales_rep");
    setReviewTeamId("");
    setReviewNote("");
  };

  const review = async (
    action: "approve" | "reject",
    target: CasdoorAccessRequestView | null = reviewTarget
  ) => {
    if (!target) return;
    setReviewing(true);
    try {
      await apiFetch(`/api/crm/casdoor-access/${target.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          action,
          ...(action === "approve" ? { role: reviewRole, teamId: reviewTeamId || null } : {}),
          note: reviewNote.trim() || null,
        }),
      });
      toast.success(action === "approve" ? t("casdoorApproved") : t("casdoorRejected"));
      setReviewTarget(null);
      await reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setReviewing(false);
    }
  };

  const openEdit = (u: SetupUser) =>
    setDraft({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      title: u.title ?? "",
      phone: u.phone ?? "",
      role: u.role,
      teamId: u.teamId ?? "",
      status: u.status,
      locale: u.locale,
      receivesInbound: u.receivesInbound,
      permissionOverrides: normalizeOverrides(u.permissionOverrides),
    });

  const save = async () => {
    if (!draft) return;
    if (!draft.fullName.trim() || (isNew && !draft.email.trim())) {
      toast.error(t("nameEmailRequired"));
      return;
    }
    setSaving(true);
    try {
      if (isNew) {
        const res = await apiFetch<{ user: SetupUser; temporaryPassword: string }>("/api/crm/users", {
          method: "POST",
          body: JSON.stringify({
            email: draft.email.trim(),
            fullName: draft.fullName.trim(),
            title: draft.title.trim() || null,
            role: draft.role,
            teamId: draft.teamId || null,
            locale: draft.locale,
            receivesInbound: draft.receivesInbound,
          }),
        });
        setPassword({ email: res.user.email, value: res.temporaryPassword });
        toast.success(t("created"));
      } else if (draft.id) {
        await apiFetch(`/api/crm/users/${draft.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            fullName: draft.fullName.trim(),
            title: draft.title.trim() || null,
            phone: draft.phone.trim() || null,
            ...(isSelf ? {} : { role: draft.role, status: draft.status }),
            teamId: draft.teamId || null,
            locale: draft.locale,
            receivesInbound: draft.receivesInbound,
            permissionOverrides: normalizeOverrides(draft.permissionOverrides),
          }),
        });
        toast.success(t("updated"));
      }
      setDraft(null);
      await reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const columns: DataTableColumn<SetupUser>[] = [
    {
      key: "fullName",
      header: t("name"),
      sortable: true,
      cell: (u) => (
        <span className="inline-flex items-center gap-2">
          <EntityAvatar name={u.fullName || u.email} size="sm" dimmed={u.status !== "active"} />
          <span>
            <span className="block font-medium">{u.fullName || u.email}</span>
            <span className="block text-xs text-muted-foreground">{u.email}</span>
          </span>
        </span>
      ),
    },
    { key: "role", header: t("role"), sortable: true, sortValue: (u) => roleLabel(u.role), cell: (u) => roleLabel(u.role) },
    { key: "team", header: t("team"), sortValue: (u) => teamName(u.teamId), sortable: true, cell: (u) => teamName(u.teamId) },
    {
      key: "status",
      header: t("status"),
      cell: (u) => (
        <span className="flex flex-wrap gap-1">
          <StatusPill tone={u.status === "active" ? "success" : "muted"}>{t(`statuses.${u.status}`)}</StatusPill>
          {u.receivesInbound ? <StatusPill tone="info">{t("inbound")}</StatusPill> : null}
          {countOverrides(u.permissionOverrides) > 0 && u.role !== "super_admin" ? (
            <StatusPill tone="warning">{t("overridesCount", { count: countOverrides(u.permissionOverrides) })}</StatusPill>
          ) : null}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "w-12 text-right",
      cell: (u) =>
        can("setup_users", "edit") ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openEdit(u);
            }}
            aria-label={t("editUserNamed", { name: u.fullName || u.email })}
            className="rounded p-1.5 hover:bg-muted"
          >
            <Pencil className="size-3.5" />
          </button>
        ) : null,
    },
  ];

  const roleLevels = draft ? (data?.matrix[draft.role] ?? {}) : {};

  return (
    <>
      <CrmPageHeader
        title={t("title")}
        description={t("description")}
        actions={
          can("setup_users", "create") ? (
            <Button
              className="gap-1.5 rounded-full bg-oboya-green text-white hover:bg-oboya-green/90"
              onClick={() => setDraft(emptyDraft(assignable.find((r) => r.id === "sales_rep")?.id ?? assignable[0]?.id ?? "sales_rep"))}
            >
              <Plus className="size-4" />
              {t("addUser")}
            </Button>
          ) : null
        }
      />

      {pendingRequests.length > 0 ? (
        <Card className="mb-4 border-oboya-orange/40">
          <CardHeader>
            <CardTitle>{t("casdoorApprovalsTitle")}</CardTitle>
            <CardDescription>{t("casdoorApprovalsDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {pendingRequests.map((request) => (
              <div
                key={request.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border/60 p-3"
              >
                <div className="min-w-0 space-y-1 text-sm">
                  <p className="font-medium text-oboya-blue-dark">
                    {request.displayName || request.email}{" "}
                    <span className="font-normal text-muted-foreground">&lt;{request.email}&gt;</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      request.casdoorType ? `${t("casdoorType")}: ${request.casdoorType}` : "",
                      request.organization ? `${t("casdoorOrganization")}: ${request.organization}` : "",
                      request.casdoorRoles.length
                        ? `${t("casdoorRoles")}: ${request.casdoorRoles.join(", ")}`
                        : "",
                      request.casdoorTags.length
                        ? `${t("casdoorTags")}: ${request.casdoorTags.join(", ")}`
                        : "",
                      [request.country, request.countryCode].filter(Boolean).join(" / "),
                      request.company ? `${t("casdoorCompany")}: ${request.company}` : "",
                      request.phone ? `${t("casdoorPhone")}: ${request.phone}` : "",
                      `${t("casdoorIntent")}: ${t(
                        request.intent === "link" ? "casdoorIntentLink" : "casdoorIntentLogin"
                      )}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("casdoorRequested", {
                      time: new Date(request.createdAt).toLocaleString(),
                    })}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => openReview(request)}
                    disabled={!can("setup_users", "edit")}
                  >
                    {t("casdoorReview")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!can("setup_users", "edit")}
                    onClick={() => {
                      if (window.confirm(t("casdoorRejectConfirm"))) void review("reject", request);
                    }}
                  >
                    {t("casdoorReject")}
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <FilterBar
        className="mb-4"
        showReset={Boolean(search || statusFilter || roleFilter)}
        onReset={() => {
          setSearch("");
          setStatusFilter("");
          setRoleFilter("");
        }}
      >
        <SearchInput value={search} onChange={setSearch} placeholder={t("searchPlaceholder")} />
        <FilterSelect
          label={t("status")}
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "active", label: t("statuses.active") },
            { value: "disabled", label: t("statuses.disabled") },
          ]}
        />
        <FilterSelect
          label={t("role")}
          value={roleFilter}
          onChange={setRoleFilter}
          options={roles.map((r) => ({ value: r.id, label: r.label }))}
        />
      </FilterBar>

      <DataTable
        data={filtered}
        columns={columns}
        getRowId={(u) => u.id}
        loading={loading && !data}
        error={error && !data ? errorMessage(error) : null}
        onRetry={() => void reload()}
        onRowClick={can("setup_users", "edit") ? openEdit : undefined}
        rowClassName={(u) => (u.status !== "active" ? "opacity-60" : undefined)}
        pageSize={25}
      />

      <FormDrawer
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={isNew ? t("newUser") : draft?.fullName || t("editUser")}
        description={isNew ? t("newUserHint") : draft?.email}
        width="lg"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {guardError ? <p className="mr-auto text-xs text-oboya-orange">{tc(`guard.${guardError}`)}</p> : null}
            <Button variant="ghost" className="rounded-full" onClick={() => setDraft(null)}>
              {tc("cancel")}
            </Button>
            <Button
              className="rounded-full bg-oboya-green text-white hover:bg-oboya-green/90"
              disabled={saving || Boolean(guardError)}
              onClick={() => void save()}
            >
              {saving ? tc("saving") : isNew ? t("createUser") : tc("save")}
            </Button>
          </div>
        }
      >
        {draft ? (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("name")} htmlFor="user-name">
                <Input id="user-name" value={draft.fullName} onChange={(e) => setDraft({ ...draft, fullName: e.target.value })} />
              </Field>
              <Field label={t("email")} htmlFor="user-email">
                <Input
                  id="user-email"
                  type="email"
                  value={draft.email}
                  disabled={!isNew}
                  onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                />
              </Field>
              <Field label={t("jobTitle")} htmlFor="user-title">
                <Input id="user-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </Field>
              {!isNew ? (
                <Field label={t("phone")} htmlFor="user-phone">
                  <Input id="user-phone" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
                </Field>
              ) : null}
              <Field label={t("role")} htmlFor="user-role" hint={isSelf ? t("selfRoleHint") : undefined}>
                <select
                  id="user-role"
                  className={selectClass}
                  value={draft.role}
                  disabled={isSelf || (!canAssignRole(actor.role, draft.role) && !isNew)}
                  onChange={(e) => setDraft({ ...draft, role: e.target.value })}
                >
                  {assignable.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                  {!assignable.some((r) => r.id === draft.role) ? (
                    <option value={draft.role}>{roleLabel(draft.role)}</option>
                  ) : null}
                </select>
              </Field>
              <Field label={t("team")} htmlFor="user-team">
                <select
                  id="user-team"
                  className={selectClass}
                  value={draft.teamId}
                  onChange={(e) => setDraft({ ...draft, teamId: e.target.value })}
                >
                  <option value="">{t("noTeam")}</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("locale")} htmlFor="user-locale">
                <select
                  id="user-locale"
                  className={selectClass}
                  value={draft.locale}
                  onChange={(e) => setDraft({ ...draft, locale: e.target.value })}
                >
                  {locales.map((l) => (
                    <option key={l} value={l}>
                      {localeLabels[l]}
                    </option>
                  ))}
                </select>
              </Field>
              {!isNew ? (
                <Field label={t("status")} htmlFor="user-status" hint={isSelf ? t("selfStatusHint") : undefined}>
                  <select
                    id="user-status"
                    className={selectClass}
                    value={draft.status}
                    disabled={isSelf}
                    onChange={(e) => setDraft({ ...draft, status: e.target.value as Draft["status"] })}
                  >
                    <option value="active">{t("statuses.active")}</option>
                    <option value="disabled">{t("statuses.disabled")}</option>
                  </select>
                </Field>
              ) : null}
            </div>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5">
              <span>
                <span className="block text-sm font-medium text-oboya-blue-dark">{t("receivesInbound")}</span>
                <span className="block text-xs text-muted-foreground">{t("receivesInboundHint")}</span>
              </span>
              <Switch
                checked={draft.receivesInbound}
                onCheckedChange={(receivesInbound) => setDraft({ ...draft, receivesInbound })}
              />
            </label>
            {!isNew ? (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-oboya-blue-dark">{t("overridesTitle")}</h3>
                {draft.role === "super_admin" ? (
                  <p className="text-xs text-muted-foreground">{t("overridesSuperAdmin")}</p>
                ) : (
                  <UserOverridesEditor
                    overrides={draft.permissionOverrides}
                    roleLevels={roleLevels}
                    onChange={(permissionOverrides) => setDraft({ ...draft, permissionOverrides })}
                  />
                )}
              </section>
            ) : null}
          </div>
        ) : null}
      </FormDrawer>

      <Dialog open={password !== null} onOpenChange={(open) => (!open ? setPassword(null) : undefined)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("passwordTitle")}</DialogTitle>
            <DialogDescription>{t("passwordDescription", { email: password?.email ?? "" })}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-oboya-soft-white px-3 py-2">
            <code className="flex-1 font-mono text-sm break-all text-oboya-blue-dark">{password?.value}</code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (password) {
                  void navigator.clipboard
                    .writeText(password.value)
                    .then(() => toast.success(t("passwordCopied")))
                    .catch(() => undefined);
                }
              }}
            >
              <Copy className="size-3.5" />
              {t("copy")}
            </Button>
          </div>
          <p className="text-xs text-oboya-orange">{t("passwordOnce")}</p>
          <DialogFooter>
            <Button className="rounded-full" onClick={() => setPassword(null)}>
              {t("passwordDone")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reviewTarget !== null} onOpenChange={(open) => (!open ? setReviewTarget(null) : undefined)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("casdoorReviewTitle")}</DialogTitle>
            <DialogDescription>
              {reviewTarget?.displayName} · {reviewTarget?.email}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {reviewTarget?.intent === "login" ? (
              <>
                <Field label={t("role")} htmlFor="casdoor-review-role">
                  <select
                    id="casdoor-review-role"
                    className={selectClass}
                    value={reviewRole}
                    onChange={(event) => setReviewRole(event.target.value)}
                  >
                    {assignable.map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t("team")} htmlFor="casdoor-review-team">
                  <select
                    id="casdoor-review-team"
                    className={selectClass}
                    value={reviewTeamId}
                    onChange={(event) => setReviewTeamId(event.target.value)}
                  >
                    <option value="">{t("noTeam")}</option>
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            ) : null}
            <Field label={t("casdoorReviewNote")} htmlFor="casdoor-review-note">
              <Input
                id="casdoor-review-note"
                value={reviewNote}
                maxLength={500}
                onChange={(event) => setReviewNote(event.target.value)}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="ghost" className="rounded-full" onClick={() => setReviewTarget(null)}>
              {tc("cancel")}
            </Button>
            <Button
              variant="outline"
              className="rounded-full"
              disabled={reviewing}
              onClick={() => void review("reject")}
            >
              {t("casdoorReject")}
            </Button>
            <Button
              className="rounded-full bg-oboya-green text-white hover:bg-oboya-green/90"
              disabled={reviewing || !assignable.some((role) => role.id === reviewRole)}
              onClick={() => void review("approve")}
            >
              {t("casdoorApprove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
