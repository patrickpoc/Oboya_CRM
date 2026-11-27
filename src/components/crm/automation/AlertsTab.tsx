"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, ErrorState, FormSkeleton } from "@/components/crm/common/states";
import { StatusPill } from "@/components/crm/common/StatusPill";
import { FormDrawer } from "@/components/crm/forms/FormDrawer";
import { Field, apiFetch, selectClass, useErrorMessage, useSetupData } from "@/components/crm/setup/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useCrm } from "@/contexts/CrmContext";
import { AUTOMATION_API, type AlertRulesResponse } from "@/lib/crm/automation/api-contract";
import type { AlertKind, AlertRule, AlertRuleInput } from "@/lib/crm/automation/types";
import { SwitchRow, type AutomationLookups } from "./shared";

const GLOBAL_KINDS = ["stalled_deal", "overdue_task", "sla_escalation"] as const;
const OVERRIDE_KINDS = ["stalled_deal", "overdue_task"] as const;
const KEY: Record<AlertKind, "stalled" | "overdue" | "sla"> = {
  stalled_deal: "stalled",
  overdue_task: "overdue",
  sla_escalation: "sla",
};
const isGlobal = (r: AlertRule) => !r.pipelineId && !r.stageId;

export function AlertsTab({ lookups }: { lookups: AutomationLookups }) {
  const t = useTranslations("automation");
  const errorMessage = useErrorMessage();
  const { can } = useCrm();
  const canEdit = can("automation", "edit");
  const { data, error, loading, reload } = useSetupData<AlertRulesResponse>(AUTOMATION_API.alertRules);
  const [editing, setEditing] = useState<AlertRule | "new" | null>(null);

  if (error && !data) return <ErrorState message={errorMessage(error)} onRetry={() => void reload()} />;
  if (loading && !data) return <FormSkeleton sections={3} fields={2} />;

  const rules = data?.rules ?? [];
  const overrides = rules.filter((r) => !isGlobal(r));
  const pipelineName = (id: string | null) => lookups.pipelines.find((p) => p.id === id)?.name ?? "";
  const stageLabel = (r: AlertRule) =>
    lookups.pipelines.flatMap((p) => p.stages).find((s) => s.id === r.stageId)?.label ?? "";

  const scope = (r: AlertRule) =>
    r.stageId
      ? t("alerts.overrides.stageScope", { pipeline: pipelineName(r.pipelineId) || "-", stage: stageLabel(r) })
      : t("alerts.overrides.pipelineScope", { pipeline: pipelineName(r.pipelineId) });
  const threshold = (r: AlertRule) =>
    r.kind === "stalled_deal"
      ? t("alerts.overrides.thresholdDays", { value: r.threshold })
      : r.kind === "overdue_task"
        ? t("alerts.overrides.thresholdHours", { value: r.threshold })
        : "-";

  const remove = async (r: AlertRule) => {
    if (!window.confirm(t("common.confirmDelete", { name: `${t(`alerts.overrides.kinds.${r.kind}`)} (${scope(r)})` }))) return;
    try {
      await apiFetch(AUTOMATION_API.alertRule(r.id), { method: "DELETE" });
      toast.success(t("common.deleted"));
      void reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-oboya-blue-dark">{t("alerts.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("alerts.description")}</p>
      </div>
      {!canEdit ? <p className="text-xs text-muted-foreground">{t("common.readOnly")}</p> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {GLOBAL_KINDS.map((kind) => (
          <GlobalCard
            key={`${kind}:${rules.find((r) => isGlobal(r) && r.kind === kind)?.updatedAt ?? "none"}`}
            kind={kind}
            rule={rules.find((r) => isGlobal(r) && r.kind === kind) ?? null}
            canEdit={canEdit}
            onSaved={() => void reload()}
          />
        ))}
      </div>

      <section className="rounded-xl border border-border/60 bg-white p-4 sm:p-5" aria-labelledby="sla-hours-title">
        <h3 id="sla-hours-title" className="text-sm font-semibold text-oboya-blue-dark">
          {t("alerts.slaHours.title")}
        </h3>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-oboya-blue-dark">
          <StatusPill tone="warning">{t("alerts.slaHours.warning", { hours: lookups.slaHours.warning })}</StatusPill>
          <StatusPill tone="danger">{t("alerts.slaHours.overdue", { hours: lookups.slaHours.overdue })}</StatusPill>
        </p>
        <p className="mt-2 text-xs text-muted-foreground">{t("alerts.slaHours.explanation", { hours: lookups.slaHours.overdue })}</p>
      </section>

      <section className="space-y-3" aria-labelledby="alert-overrides-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id="alert-overrides-title" className="text-sm font-semibold text-oboya-blue-dark">
              {t("alerts.overrides.title")}
            </h3>
            <p className="text-xs text-muted-foreground">{t("alerts.overrides.description")}</p>
          </div>
          {can("automation", "create") ? (
            <Button type="button" variant="outline" onClick={() => setEditing("new")} className="min-h-11 md:min-h-8">
              <Plus className="size-4" aria-hidden /> {t("alerts.overrides.add")}
            </Button>
          ) : null}
        </div>
        {overrides.length === 0 ? (
          <EmptyState title={t("alerts.overrides.empty")} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border/60 bg-white">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-border/60 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2 font-medium">{t("alerts.overrides.scope")}</th>
                  <th className="px-3 py-2 font-medium">{t("alerts.overrides.kind")}</th>
                  <th className="px-3 py-2 font-medium">{t("alerts.overrides.threshold")}</th>
                  <th className="px-3 py-2 font-medium">{t("common.active")}</th>
                  <th className="px-3 py-2 text-right font-medium">
                    <span className="sr-only">{t("alerts.overrides.actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {overrides.map((r) => (
                  <tr key={r.id} className="border-b border-border/40 last:border-0">
                    <td className="px-3 py-2">{scope(r)}</td>
                    <td className="px-3 py-2">{t(`alerts.overrides.kinds.${r.kind}`)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{threshold(r)}</td>
                    <td className="px-3 py-2">
                      <StatusPill tone={r.active ? "success" : "muted"} size="xs">
                        {r.active ? t("common.active") : t("common.inactive")}
                      </StatusPill>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        {canEdit ? (
                          <button
                            type="button"
                            onClick={() => setEditing(r)}
                            aria-label={`${t("common.edit")}: ${scope(r)}`}
                            className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted md:min-h-8 md:min-w-8"
                          >
                            <Pencil className="size-4" />
                          </button>
                        ) : null}
                        {can("automation", "delete") ? (
                          <button
                            type="button"
                            onClick={() => void remove(r)}
                            aria-label={`${t("common.delete")}: ${scope(r)}`}
                            className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-oboya-orange hover:bg-oboya-orange/10 md:min-h-8 md:min-w-8"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editing ? (
        <OverrideEditor
          key={editing === "new" ? "new" : editing.id}
          rule={editing === "new" ? null : editing}
          lookups={lookups}
          onClose={() => setEditing(null)}
          onSaved={() => void reload()}
        />
      ) : null}
    </div>
  );
}

function GlobalCard({
  kind,
  rule,
  canEdit,
  onSaved,
}: {
  kind: AlertKind;
  rule: AlertRule | null;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations("automation.alerts");
  const tc = useTranslations("automation.common");
  const errorMessage = useErrorMessage();
  const key = KEY[kind];
  const [threshold, setThreshold] = useState<number>(rule?.threshold ?? (kind === "stalled_deal" ? 14 : 0));
  const [notifyManager, setNotifyManager] = useState(rule?.notifyManager ?? kind === "sla_escalation");
  const [active, setActive] = useState(rule?.active ?? true);
  const [saving, setSaving] = useState(false);
  const valid = kind === "sla_escalation" || (Number.isInteger(threshold) && threshold >= 0 && threshold <= 3650);

  const save = async () => {
    setSaving(true);
    try {
      const body = { kind, threshold: kind === "sla_escalation" ? 0 : threshold, notifyManager, active };
      await apiFetch(rule ? AUTOMATION_API.alertRule(rule.id) : AUTOMATION_API.alertRules, {
        method: rule ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      toast.success(tc("saved"));
      onSaved();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const dirty =
    !rule ||
    rule.active !== active ||
    rule.notifyManager !== notifyManager ||
    (kind !== "sla_escalation" && rule.threshold !== threshold);

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border/60 bg-white p-4 sm:p-5" aria-labelledby={`alert-${kind}`}>
      <div>
        <h3 id={`alert-${kind}`} className="text-sm font-semibold text-oboya-blue-dark">
          {t(`${key}.title`)}
        </h3>
        <p className="text-xs text-muted-foreground">{t(`${key}.description`)}</p>
      </div>
      {!rule ? <p className="text-xs text-muted-foreground">{t("missingGlobal")}</p> : null}
      <SwitchRow id={`alert-active-${kind}`} label={kind === "sla_escalation" ? t("sla.toggle") : t("enabled")}>
        <Switch id={`alert-active-${kind}`} checked={active} onCheckedChange={setActive} disabled={!canEdit} />
      </SwitchRow>
      {kind !== "sla_escalation" ? (
        <Field label={kind === "stalled_deal" ? t("stalled.label") : t("overdue.label")} htmlFor={`alert-threshold-${kind}`}>
          <Input
            id={`alert-threshold-${kind}`}
            className="h-9"
            type="number"
            min={0}
            max={3650}
            step={1}
            disabled={!canEdit}
            value={Number.isNaN(threshold) ? "" : threshold}
            onChange={(e) => setThreshold(e.target.value === "" ? Number.NaN : Number(e.target.value))}
          />
        </Field>
      ) : null}
      <SwitchRow id={`alert-manager-${kind}`} label={t("notifyManager")}>
        <Switch id={`alert-manager-${kind}`} checked={notifyManager} onCheckedChange={setNotifyManager} disabled={!canEdit} />
      </SwitchRow>
      {canEdit ? (
        <Button type="button" onClick={save} disabled={!valid || saving || !dirty} className="mt-auto min-h-11 self-start md:min-h-8">
          {saving ? tc("saving") : tc("save")}
        </Button>
      ) : null}
    </section>
  );
}

function OverrideEditor({
  rule,
  lookups,
  onClose,
  onSaved,
}: {
  rule: AlertRule | null;
  lookups: AutomationLookups;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("automation");
  const errorMessage = useErrorMessage();
  const [draft, setDraft] = useState<AlertRuleInput>(() => ({
    kind: rule?.kind ?? "stalled_deal",
    pipelineId: rule?.pipelineId ?? lookups.pipelines.find((p) => p.isDefault)?.id ?? lookups.pipelines[0]?.id ?? null,
    stageId: rule?.stageId ?? null,
    threshold: rule?.threshold ?? 14,
    notifyManager: rule?.notifyManager ?? false,
    active: rule?.active ?? true,
  }));
  const [saving, setSaving] = useState(false);
  const patch = (p: Partial<AlertRuleInput>) => setDraft((d) => ({ ...d, ...p }));
  const pipeline = lookups.pipelines.find((p) => p.id === draft.pipelineId);
  const valid = Boolean(draft.pipelineId) && Number.isInteger(draft.threshold) && draft.threshold >= 0 && draft.threshold <= 3650;

  const save = async () => {
    setSaving(true);
    try {
      await apiFetch(rule ? AUTOMATION_API.alertRule(rule.id) : AUTOMATION_API.alertRules, {
        method: rule ? "PATCH" : "POST",
        body: JSON.stringify(draft),
      });
      toast.success(t("common.saved"));
      onSaved();
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormDrawer
      open
      onClose={onClose}
      width="sm"
      title={rule ? t("alerts.overrides.editTitle") : t("alerts.overrides.newTitle")}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} className="min-h-11 md:min-h-8">
            {t("common.cancel")}
          </Button>
          <Button type="button" onClick={save} disabled={!valid || saving} className="min-h-11 md:min-h-8">
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label={t("alerts.overrides.kind")} htmlFor="ov-kind">
          <select id="ov-kind" className={selectClass} value={draft.kind} onChange={(e) => patch({ kind: e.target.value as AlertKind })}>
            {OVERRIDE_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`alerts.overrides.kinds.${k}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("alerts.overrides.pipeline")} htmlFor="ov-pipeline">
          <select id="ov-pipeline" className={selectClass} value={draft.pipelineId ?? ""} onChange={(e) => patch({ pipelineId: e.target.value || null, stageId: null })}>
            {lookups.pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("alerts.overrides.stage")} htmlFor="ov-stage">
          <select id="ov-stage" className={selectClass} value={draft.stageId ?? ""} onChange={(e) => patch({ stageId: e.target.value || null })}>
            <option value="">{t("alerts.overrides.allStages")}</option>
            {(pipeline?.stages ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field
          label={draft.kind === "stalled_deal" ? t("alerts.stalled.label") : t("alerts.overdue.label")}
          htmlFor="ov-threshold"
        >
          <Input
            id="ov-threshold"
            className="h-9"
            type="number"
            min={0}
            max={3650}
            step={1}
            value={Number.isNaN(draft.threshold) ? "" : draft.threshold}
            onChange={(e) => patch({ threshold: e.target.value === "" ? Number.NaN : Number(e.target.value) })}
          />
        </Field>
        <SwitchRow id="ov-manager" label={t("alerts.notifyManager")}>
          <Switch id="ov-manager" checked={draft.notifyManager} onCheckedChange={(notifyManager) => patch({ notifyManager })} />
        </SwitchRow>
        <SwitchRow id="ov-active" label={t("common.active")}>
          <Switch id="ov-active" checked={draft.active} onCheckedChange={(active) => patch({ active })} />
        </SwitchRow>
      </div>
    </FormDrawer>
  );
}
