"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useCrm } from "@/contexts/CrmContext";
import { CrmPageHeader } from "@/components/crm/layout/CrmPageHeader";
import { DataTable, type DataTableColumn } from "@/components/crm/data-table/DataTable";
import { FormDrawer } from "@/components/crm/forms/FormDrawer";
import { StatusPill } from "@/components/crm/common/StatusPill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { SetupEntity } from "@/lib/crm/setup/rows";
import { Field, apiFetch, selectClass, useErrorMessage, useSetupData } from "./shared";

const CURRENCIES = ["USD", "BRL", "EUR", "CNY"] as const;

type Draft = {
  id?: string;
  name: string;
  legalName: string;
  countryCode: string;
  taxId: string;
  defaultCurrency: SetupEntity["defaultCurrency"];
  active: boolean;
};

/** Setup -> Companies (D5): group companies in crm_entities. */
export function CompaniesSetup() {
  const t = useTranslations("setup.companies");
  const tc = useTranslations("setup.common");
  const errorMessage = useErrorMessage();
  const { can } = useCrm();
  const { data, error, loading, reload } = useSetupData<{ entities: SetupEntity[] }>("/api/crm/entities");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const body = JSON.stringify({
        name: draft.name.trim(),
        legalName: draft.legalName.trim() || null,
        countryCode: draft.countryCode.trim() || null,
        taxId: draft.taxId.trim() || null,
        defaultCurrency: draft.defaultCurrency,
        active: draft.active,
      });
      await apiFetch(draft.id ? `/api/crm/entities/${draft.id}` : "/api/crm/entities", {
        method: draft.id ? "PATCH" : "POST",
        body,
      });
      toast.success(draft.id ? t("updated") : t("created"));
      setDraft(null);
      await reload();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (entity: SetupEntity) => {
    if (!window.confirm(t("deleteConfirm", { name: entity.name }))) return;
    try {
      await apiFetch(`/api/crm/entities/${entity.id}`, { method: "DELETE" });
      toast.success(t("deleted"));
      await reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const columns: DataTableColumn<SetupEntity>[] = [
    {
      key: "name",
      header: t("name"),
      sortable: true,
      cell: (e) => (
        <span>
          <span className="block font-medium">{e.name}</span>
          {e.legalName ? <span className="block text-xs text-muted-foreground">{e.legalName}</span> : null}
        </span>
      ),
    },
    { key: "countryCode", header: t("country"), sortable: true, cell: (e) => e.countryCode ?? "—" },
    { key: "taxId", header: t("taxId"), cell: (e) => e.taxId ?? "—" },
    { key: "defaultCurrency", header: t("currency"), sortable: true, cell: (e) => e.defaultCurrency },
    {
      key: "active",
      header: t("status"),
      cell: (e) => (
        <StatusPill tone={e.active ? "success" : "muted"}>{e.active ? t("active") : t("inactive")}</StatusPill>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "w-20 text-right",
      cell: (e) => (
        <span className="inline-flex gap-1">
          {can("setup_companies", "edit") ? (
            <button
              type="button"
              aria-label={t("editNamed", { name: e.name })}
              className="rounded p-1.5 hover:bg-muted"
              onClick={() =>
                setDraft({
                  id: e.id,
                  name: e.name,
                  legalName: e.legalName ?? "",
                  countryCode: e.countryCode ?? "",
                  taxId: e.taxId ?? "",
                  defaultCurrency: e.defaultCurrency,
                  active: e.active,
                })
              }
            >
              <Pencil className="size-3.5" />
            </button>
          ) : null}
          {can("setup_companies", "delete") ? (
            <button
              type="button"
              aria-label={t("deleteNamed", { name: e.name })}
              className="rounded p-1.5 text-oboya-orange hover:bg-muted"
              onClick={() => void remove(e)}
            >
              <Trash2 className="size-3.5" />
            </button>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <>
      <CrmPageHeader
        title={t("title")}
        description={t("description")}
        actions={
          can("setup_companies", "create") ? (
            <Button
              className="gap-1.5 rounded-full bg-oboya-green text-white hover:bg-oboya-green/90"
              onClick={() =>
                setDraft({ name: "", legalName: "", countryCode: "", taxId: "", defaultCurrency: "USD", active: true })
              }
            >
              <Plus className="size-4" />
              {t("add")}
            </Button>
          ) : null
        }
      />
      <DataTable
        data={data?.entities ?? []}
        columns={columns}
        getRowId={(e) => e.id}
        loading={loading && !data}
        error={error && !data ? errorMessage(error) : null}
        onRetry={() => void reload()}
        rowClassName={(e) => (e.active ? undefined : "opacity-60")}
        pageSize={50}
      />
      <FormDrawer
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? draft.name : t("new")}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" className="rounded-full" onClick={() => setDraft(null)}>
              {tc("cancel")}
            </Button>
            <Button
              className="rounded-full bg-oboya-green text-white hover:bg-oboya-green/90"
              disabled={saving || !draft?.name.trim() || (draft.countryCode !== "" && !/^[A-Za-z]{2}$/.test(draft.countryCode))}
              onClick={() => void save()}
            >
              {saving ? tc("saving") : tc("save")}
            </Button>
          </div>
        }
      >
        {draft ? (
          <div className="space-y-4">
            <Field label={t("name")} htmlFor="entity-name">
              <Input id="entity-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label={t("legalName")} htmlFor="entity-legal">
              <Input id="entity-legal" value={draft.legalName} onChange={(e) => setDraft({ ...draft, legalName: e.target.value })} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t("country")} htmlFor="entity-country" hint={t("countryHint")}>
                <Input
                  id="entity-country"
                  maxLength={2}
                  className="uppercase"
                  value={draft.countryCode}
                  onChange={(e) => setDraft({ ...draft, countryCode: e.target.value.toUpperCase() })}
                />
              </Field>
              <Field label={t("currency")} htmlFor="entity-currency">
                <select
                  id="entity-currency"
                  className={selectClass}
                  value={draft.defaultCurrency}
                  onChange={(e) => setDraft({ ...draft, defaultCurrency: e.target.value as Draft["defaultCurrency"] })}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label={t("taxId")} htmlFor="entity-tax">
              <Input id="entity-tax" value={draft.taxId} onChange={(e) => setDraft({ ...draft, taxId: e.target.value })} />
            </Field>
            <label className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-3 py-2.5">
              <span className="text-sm font-medium text-oboya-blue-dark">{t("active")}</span>
              <Switch checked={draft.active} onCheckedChange={(active) => setDraft({ ...draft, active })} />
            </label>
          </div>
        ) : null}
      </FormDrawer>
    </>
  );
}
