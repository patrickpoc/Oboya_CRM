"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useCrm } from "@/contexts/CrmContext";
import { CrmPageHeader } from "@/components/crm/layout/CrmPageHeader";
import { EditorGuard } from "@/components/crm/common/unsaved-changes";
import { ErrorState, FormSkeleton } from "@/components/crm/common/states";
import { StatusPill } from "@/components/crm/common/StatusPill";
import type { AccessMatrix } from "@/lib/crm/permissions/access-types";
import { matrixEquals } from "@/lib/crm/setup/matrix";
import type { SetupRole } from "@/lib/crm/setup/rows";
import { cn } from "@/lib/utils";
import { MatrixEditor } from "./MatrixEditor";
import { apiFetch, useErrorMessage, useSetupData } from "./shared";

type AccessPayload = { matrix: AccessMatrix; roles: SetupRole[] };

export function AccessSetup() {
  const t = useTranslations("setup.access");
  const errorMessage = useErrorMessage();
  const { can } = useCrm();
  const canEdit = can("setup_access", "edit");
  const { data, setData, error, loading, reload } = useSetupData<AccessPayload>("/api/crm/access-control");
  const [draft, setDraft] = useState<AccessMatrix | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const roles = useMemo(() => data?.roles ?? [], [data]);
  const roleIds = roles.map((r) => r.id);
  const matrix = draft ?? data?.matrix ?? {};
  const dirty = Boolean(draft && data && !matrixEquals(draft, data.matrix, roleIds));
  const roleId = selected ?? roles.find((r) => r.id !== "super_admin")?.id ?? roles[0]?.id ?? null;

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const next = await apiFetch<AccessPayload>("/api/crm/access-control", {
        method: "PUT",
        body: JSON.stringify({ matrix: draft }),
      });
      setData(next);
      setDraft(null);
      toast.success(t("saved"));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <CrmPageHeader title={t("title")} description={t("description")} />
      {error && !data ? (
        <ErrorState message={errorMessage(error)} onRetry={() => void reload()} />
      ) : loading && !data ? (
        <FormSkeleton sections={1} fields={4} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          <nav aria-label={t("rolesTitle")} className="rounded-xl border border-border/60 bg-white p-2">
            <h2 className="px-2 pt-1 pb-2 text-sm font-semibold text-oboya-blue-dark">{t("rolesTitle")}</h2>
            <ul className="flex gap-1 overflow-x-auto lg:flex-col">
              {roles.map((role) => (
                <li key={role.id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => setSelected(role.id)}
                    aria-current={role.id === roleId}
                    className={cn(
                      "flex w-full flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors",
                      role.id === roleId ? "border-oboya-blue/40 bg-oboya-blue/5" : "border-transparent hover:bg-muted/60",
                      !role.active && "opacity-60"
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium text-oboya-blue-dark">
                      {role.label}
                      {role.system ? <StatusPill size="xs">{t("system")}</StatusPill> : null}
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">{role.id}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <section className="rounded-xl border border-border/60 bg-white p-4">
            {roleId ? (
              <MatrixEditor
                roleId={roleId}
                locked={roleId === "super_admin" || !canEdit}
                matrix={matrix}
                onChange={(module, level) =>
                  setDraft({ ...matrix, [roleId]: { ...(matrix[roleId] ?? {}), [module]: level } })
                }
              />
            ) : null}
            {!canEdit ? <p className="mt-3 text-xs text-muted-foreground">{t("readOnly")}</p> : null}
          </section>
        </div>
      )}
      <EditorGuard dirty={dirty} saving={saving} onSave={() => void save()} onDiscard={() => setDraft(null)} />
    </>
  );
}
