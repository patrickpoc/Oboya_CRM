"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useCrm } from "@/contexts/CrmContext";
import { CrmPageHeader } from "@/components/crm/layout/CrmPageHeader";
import { EditorGuard } from "@/components/crm/common/unsaved-changes";
import { EntityAvatar } from "@/components/crm/common/EntityAvatar";
import { ErrorState, FormSkeleton } from "@/components/crm/common/states";
import { StatusPill } from "@/components/crm/common/StatusPill";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Field, apiFetch, selectClass, useErrorMessage, useSetupData } from "./shared";

type Mode = "round_robin" | "default_owner";
type AssignmentUser = {
  id: string;
  fullName: string;
  email: string;
  roleLabel: string;
  canWrite: boolean;
  status: string;
  receivesInbound: boolean;
};
type Payload = { mode: Mode; defaultOwnerId: string | null; users: AssignmentUser[] };

/** Setup -> Lead assignment (D3). */
export function LeadAssignmentSetup() {
  const t = useTranslations("setup.leadAssignment");
  const errorMessage = useErrorMessage();
  const { can } = useCrm();
  const canEdit = can("setup_lead_assignment", "edit");
  const { data, setData, error, loading, reload } = useSetupData<Payload>("/api/crm/settings/lead-assignment");
  const [draft, setDraft] = useState<{ mode: Mode; defaultOwnerId: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);

  const mode = draft?.mode ?? data?.mode ?? "round_robin";
  const defaultOwnerId = draft ? draft.defaultOwnerId : (data?.defaultOwnerId ?? null);
  const dirty = Boolean(draft && data && (draft.mode !== data.mode || draft.defaultOwnerId !== data.defaultOwnerId));
  const users = data?.users ?? [];
  const activeUsers = users.filter((u) => u.status === "active");
  const pool = activeUsers.filter((u) => u.receivesInbound && u.canWrite);

  const save = async () => {
    setSaving(true);
    try {
      setData(
        await apiFetch<Payload>("/api/crm/settings/lead-assignment", {
          method: "PUT",
          body: JSON.stringify({ mode, defaultOwnerId }),
        })
      );
      setDraft(null);
      toast.success(t("saved"));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (user: AssignmentUser, receivesInbound: boolean) => {
    if (!data) return;
    setToggling(user.id);
    try {
      await apiFetch(`/api/crm/settings/lead-assignment/users/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ receivesInbound }),
      });
      setData({ ...data, users: data.users.map((u) => (u.id === user.id ? { ...u, receivesInbound } : u)) });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setToggling(null);
    }
  };

  return (
    <>
      <CrmPageHeader title={t("title")} description={t("description")} />
      {error && !data ? (
        <ErrorState message={errorMessage(error)} onRetry={() => void reload()} />
      ) : loading && !data ? (
        <FormSkeleton sections={2} fields={2} />
      ) : (
        <div className="space-y-6">
          <section className="space-y-4 rounded-xl border border-border/60 bg-white p-5">
            <h2 className="text-sm font-semibold text-oboya-blue-dark">{t("modeTitle")}</h2>
            <div role="radiogroup" aria-label={t("modeTitle")} className="grid gap-2 sm:grid-cols-2">
              {(["round_robin", "default_owner"] as Mode[]).map((m) => (
                <label
                  key={m}
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2.5",
                    mode === m ? "border-oboya-blue/50 bg-oboya-blue/5" : "border-border/60"
                  )}
                >
                  <input
                    type="radio"
                    name="assignment-mode"
                    className="mt-1 accent-[var(--oboya-blue)]"
                    checked={mode === m}
                    disabled={!canEdit}
                    onChange={() => setDraft({ mode: m, defaultOwnerId })}
                  />
                  <span>
                    <span className="block text-sm font-medium text-oboya-blue-dark">{t(`modes.${m}`)}</span>
                    <span className="block text-xs text-muted-foreground">{t(`modeHints.${m}`)}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="max-w-sm">
              <Field
                label={t("defaultOwner")}
                htmlFor="default-owner"
                hint={mode === "round_robin" ? t("defaultOwnerFallbackHint") : t("defaultOwnerHint")}
              >
                <select
                  id="default-owner"
                  className={selectClass}
                  disabled={!canEdit}
                  value={defaultOwnerId ?? ""}
                  onChange={(e) => setDraft({ mode, defaultOwnerId: e.target.value || null })}
                >
                  <option value="">{t("noDefaultOwner")}</option>
                  {activeUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {mode === "default_owner" && !defaultOwnerId ? (
              <p className="text-xs text-oboya-orange">{t("defaultOwnerRequired")}</p>
            ) : null}
            {mode === "round_robin" && pool.length === 0 ? (
              <p className="text-xs text-oboya-orange">{t("emptyPool")}</p>
            ) : null}
          </section>

          <section className="rounded-xl border border-border/60 bg-white">
            <header className="border-b border-border/60 px-5 py-3">
              <h2 className="text-sm font-semibold text-oboya-blue-dark">{t("usersTitle")}</h2>
              <p className="text-xs text-muted-foreground">{t("usersHint", { count: pool.length })}</p>
            </header>
            <ul className="divide-y divide-border/50">
              {users.map((u) => (
                <li key={u.id} className={cn("flex items-center gap-3 px-5 py-3", u.status !== "active" && "opacity-60")}>
                  <EntityAvatar name={u.fullName} size="sm" dimmed={u.status !== "active"} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-oboya-blue-dark">{u.fullName}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {u.roleLabel} · {u.email}
                    </span>
                  </span>
                  {u.status !== "active" ? <StatusPill tone="muted">{t("disabled")}</StatusPill> : null}
                  {!u.canWrite ? <StatusPill tone="neutral">{t("readOnlyRole")}</StatusPill> : null}
                  <label className="inline-flex items-center">
                    <span className="sr-only">{t("receivesInboundNamed", { name: u.fullName })}</span>
                    <Switch
                      checked={u.receivesInbound}
                      onCheckedChange={(next) => (canEdit && toggling !== u.id ? void toggle(u, next) : undefined)}
                    />
                  </label>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
      <EditorGuard
        dirty={dirty}
        saving={saving}
        disabled={mode === "default_owner" && !defaultOwnerId}
        onSave={() => void save()}
        onDiscard={() => setDraft(null)}
      />
    </>
  );
}
