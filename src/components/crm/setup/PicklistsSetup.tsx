"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Pencil, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { useCrm } from "@/contexts/CrmContext";
import { CrmPageHeader } from "@/components/crm/layout/CrmPageHeader";
import { FilterTabs } from "@/components/crm/common/FilterBar";
import { ErrorState, ListSkeleton, EmptyState } from "@/components/crm/common/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PICKLISTS, PICKLIST_VALUE_RE, slugifyPicklistValue, type PicklistName } from "@/lib/crm/setup/picklists";
import type { SetupPicklistValue } from "@/lib/crm/setup/rows";
import { cn } from "@/lib/utils";
import { SortableList, apiFetch, useErrorMessage, useSetupData } from "./shared";

/** Setup -> Picklists: one tab per picklist; label edit, add, reorder, deactivate. */
export function PicklistsSetup() {
  const t = useTranslations("setup.picklists");
  const tc = useTranslations("setup.common");
  const errorMessage = useErrorMessage();
  const { can } = useCrm();
  const { data, setData, error, loading, reload } = useSetupData<{ values: SetupPicklistValue[] }>("/api/crm/picklists");
  const [tab, setTab] = useState<PicklistName>("lead_source");
  const [editing, setEditing] = useState<{ id: string; label: string } | null>(null);
  const [adding, setAdding] = useState<{ label: string; value: string; touched: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = can("setup_picklists", "edit");

  const all = useMemo(() => data?.values ?? [], [data]);
  const values = useMemo(
    () => all.filter((v) => v.picklist === tab).sort((a, b) => a.sortOrder - b.sortOrder),
    [all, tab]
  );

  const replace = (next: SetupPicklistValue[]) =>
    setData({ values: [...all.filter((v) => !next.some((n) => n.id === v.id)), ...next] });

  const patch = async (id: string, body: Record<string, unknown>, success?: string) => {
    setBusy(true);
    try {
      const res = await apiFetch<{ value: SetupPicklistValue }>(`/api/crm/picklists/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      replace([res.value]);
      if (success) toast.success(success);
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const reorder = async (ids: string[]) => {
    const byId = new Map(values.map((v) => [v.id, v]));
    replace(ids.map((id, i) => ({ ...byId.get(id)!, sortOrder: (i + 1) * 10 })));
    try {
      const res = await apiFetch<{ values: SetupPicklistValue[] }>("/api/crm/picklists/reorder", {
        method: "POST",
        body: JSON.stringify({ picklist: tab, ids }),
      });
      replace(res.values);
    } catch (e) {
      toast.error(errorMessage(e));
      await reload();
    }
  };

  const add = async () => {
    if (!adding) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ value: SetupPicklistValue }>("/api/crm/picklists", {
        method: "POST",
        body: JSON.stringify({ picklist: tab, value: adding.value, label: adding.label.trim() }),
      });
      replace([res.value]);
      setAdding(null);
      toast.success(t("added"));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <CrmPageHeader
        title={t("title")}
        description={t("description")}
        actions={
          can("setup_picklists", "create") ? (
            <Button
              className="gap-1.5 rounded-full bg-oboya-green text-white hover:bg-oboya-green/90"
              onClick={() => setAdding({ label: "", value: "", touched: false })}
            >
              <Plus className="size-4" />
              {t("add")}
            </Button>
          ) : null
        }
      />
      <FilterTabs
        className="mb-4"
        value={tab}
        onChange={(v) => {
          setTab(v as PicklistName);
          setEditing(null);
          setAdding(null);
        }}
        options={PICKLISTS.map((p) => ({
          value: p,
          label: t(`names.${p}`),
          count: all.filter((v) => v.picklist === p).length,
        }))}
      />

      {adding ? (
        <form
          className="mb-4 flex flex-col gap-2 rounded-xl border border-oboya-blue/30 bg-oboya-blue/5 p-3 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <label className="flex-1 space-y-1 text-xs font-medium">
            {t("label")}
            <Input
              autoFocus
              value={adding.label}
              onChange={(e) =>
                setAdding({
                  ...adding,
                  label: e.target.value,
                  value: adding.touched ? adding.value : slugifyPicklistValue(e.target.value, tab),
                })
              }
            />
          </label>
          <label className="flex-1 space-y-1 text-xs font-medium">
            {t("value")}
            <Input
              className="font-mono"
              value={adding.value}
              aria-invalid={adding.value !== "" && !PICKLIST_VALUE_RE.test(adding.value)}
              onChange={(e) => setAdding({ ...adding, value: e.target.value.toLowerCase(), touched: true })}
            />
          </label>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setAdding(null)}>
              {tc("cancel")}
            </Button>
            <Button
              type="submit"
              className="bg-oboya-green text-white hover:bg-oboya-green/90"
              disabled={busy || !adding.label.trim() || !PICKLIST_VALUE_RE.test(adding.value)}
            >
              {t("add")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground sm:hidden">{t("valueHint")}</p>
        </form>
      ) : null}

      {error && !data ? (
        <ErrorState message={errorMessage(error)} onRetry={() => void reload()} />
      ) : loading && !data ? (
        <ListSkeleton rows={6} />
      ) : values.length === 0 ? (
        <EmptyState title={t("empty")} />
      ) : (
        <SortableList
          items={values}
          disabled={!canEdit}
          onReorder={(ids) => void reorder(ids)}
          itemLabel={(v) => v.label}
          renderItem={(v) => (
            <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", !v.active && "opacity-60")}>
              {editing?.id === v.id ? (
                <form
                  className="flex min-w-0 flex-1 items-center gap-1"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (await patch(v.id, { label: editing.label.trim() }, t("saved"))) setEditing(null);
                  }}
                >
                  <Input
                    autoFocus
                    aria-label={t("label")}
                    value={editing.label}
                    maxLength={120}
                    onChange={(e) => setEditing({ ...editing, label: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setEditing(null);
                    }}
                    className="h-8"
                  />
                  <button type="submit" disabled={busy || !editing.label.trim()} aria-label={tc("save")} className="rounded p-1.5 text-oboya-green hover:bg-muted">
                    <Check className="size-4" />
                  </button>
                  <button type="button" onClick={() => setEditing(null)} aria-label={tc("cancel")} className="rounded p-1.5 hover:bg-muted">
                    <X className="size-4" />
                  </button>
                </form>
              ) : (
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-oboya-blue-dark">{v.label}</span>
                  <span className="block font-mono text-[11px] text-muted-foreground">{v.value}</span>
                </span>
              )}
              {canEdit ? (
                <>
                  {editing?.id !== v.id ? (
                    <button
                      type="button"
                      aria-label={t("editNamed", { label: v.label })}
                      onClick={() => setEditing({ id: v.id, label: v.label })}
                      className="rounded p-1.5 hover:bg-muted"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                  ) : null}
                  <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="hidden sm:inline">{v.active ? t("active") : t("inactive")}</span>
                    <span className="sr-only">{t("activeNamed", { label: v.label })}</span>
                    <Switch checked={v.active} onCheckedChange={(active) => void patch(v.id, { active })} />
                  </label>
                </>
              ) : null}
            </div>
          )}
        />
      )}
      <p className="mt-2 text-xs text-muted-foreground">{t("valueHint")}</p>
    </>
  );
}
