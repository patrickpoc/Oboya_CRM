"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { FormDrawer } from "@/components/crm/forms/FormDrawer";
import { Field, apiFetch, selectClass, useErrorMessage } from "@/components/crm/setup/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { countryFlagOptions } from "@/constants/country-flags";
import { resolveAssignment } from "@/lib/crm/automation/matching";
import { AUTOMATION_API, type AssignmentRuleResponse } from "@/lib/crm/automation/api-contract";
import { MAX_POOL_USERS, type AssignmentRule, type AssignmentRuleInput } from "@/lib/crm/automation/types";
import { MultiPicker, SwitchRow, countryName, type AutomationLookups } from "./shared";

const blank = (): AssignmentRuleInput => ({
  name: "",
  active: true,
  countryCodes: [],
  entityIds: [],
  sources: [],
  targetType: "user",
  targetUserId: null,
  poolUserIds: [],
  stopProcessing: false,
  notifyAssignee: true,
});

export function RuleEditor({
  rule,
  open,
  lookups,
  rules,
  onClose,
  onSaved,
}: {
  /** null = create. */
  rule: AssignmentRule | null;
  open: boolean;
  lookups: AutomationLookups;
  rules: AssignmentRule[];
  onClose: () => void;
  onSaved: () => void;
}) {
  if (!open) return null;
  // Remount per rule so the draft starts from the stored row.
  return <RuleEditorForm key={rule?.id ?? "new"} rule={rule} lookups={lookups} rules={rules} onClose={onClose} onSaved={onSaved} />;
}

function RuleEditorForm({
  rule,
  lookups,
  rules,
  onClose,
  onSaved,
}: {
  rule: AssignmentRule | null;
  lookups: AutomationLookups;
  rules: AssignmentRule[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("automation");
  const tf = useTranslations("automation.assignment.fields");
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const [draft, setDraft] = useState<AssignmentRuleInput>(() => {
    if (!rule) return blank();
    const { id: _id, createdAt: _c, updatedAt: _u, sortOrder: _s, ...input } = rule;
    void _id; void _c; void _u; void _s;
    return input;
  });
  const [saving, setSaving] = useState(false);
  const [sample, setSample] = useState({ countryCode: "", entityId: "", source: "" });
  const patch = (p: Partial<AssignmentRuleInput>) => setDraft((d) => ({ ...d, ...p }));

  const countries = useMemo(
    () => countryFlagOptions.map((c) => ({ value: c.code, label: countryName(c.code, locale, c.label), hint: c.code })),
    [locale]
  );
  // Keep inactive users selectable only if already chosen.
  const users = useMemo(
    () => lookups.users.filter((u) => u.active || draft.poolUserIds.includes(u.value) || draft.targetUserId === u.value),
    [lookups.users, draft.poolUserIds, draft.targetUserId]
  );

  // Client-side estimate from the draft plus the saved rules; the round-robin cursor is not consulted.
  const estimate = useMemo(() => {
    const eligible = new Set(lookups.users.filter((u) => u.active).map((u) => u.value));
    const maxOrder = rules.reduce((m, r) => Math.max(m, r.sortOrder), 0);
    const draftRule = { ...draft, id: rule?.id ?? "draft", sortOrder: rule?.sortOrder ?? maxOrder + 1 };
    const list = [...rules.filter((r) => r.id !== draftRule.id), draftRule];
    return resolveAssignment(
      list,
      { countryCode: sample.countryCode || null, entityId: sample.entityId || null, source: sample.source || null },
      { eligibleUserIds: eligible, fallback: { ownerId: null, via: "default" } }
    );
  }, [draft, rules, rule, lookups.users, sample]);
  const estimateOwner = estimate.ownerId ? lookups.users.find((u) => u.value === estimate.ownerId)?.label : null;
  const tp = useTranslations("automation.assignment.editorPreview");

  const targetOk = draft.targetType === "user" ? draft.targetUserId !== null : draft.poolUserIds.length > 0;
  const valid = draft.name.trim().length > 0 && targetOk;

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        ...draft,
        name: draft.name.trim(),
        targetUserId: draft.targetType === "user" ? draft.targetUserId : null,
        poolUserIds: draft.targetType === "round_robin" ? draft.poolUserIds : [],
      };
      await apiFetch<AssignmentRuleResponse>(
        rule ? AUTOMATION_API.assignmentRule(rule.id) : AUTOMATION_API.assignmentRules,
        { method: rule ? "PATCH" : "POST", body: JSON.stringify(body) }
      );
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
      title={rule ? t("assignment.editTitle") : t("assignment.newTitle")}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          {!targetOk ? <p className="text-xs text-oboya-orange">{t("assignment.invalidTarget")}</p> : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} className="min-h-11 md:min-h-8">
              {t("common.cancel")}
            </Button>
            <Button type="button" onClick={save} disabled={!valid || saving} className="min-h-11 md:min-h-8">
              {saving ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <Field label={tf("name")} htmlFor="rule-name">
          <Input
            id="rule-name"
            value={draft.name}
            maxLength={120}
            onChange={(e) => patch({ name: e.target.value })}
            className="h-9"
          />
        </Field>

        <Field label={tf("countries")} hint={tf("countriesHint")}>
          <MultiPicker id="rule-countries" label={tf("countries")} options={countries} value={draft.countryCodes} onChange={(countryCodes) => patch({ countryCodes })} />
        </Field>
        <Field label={tf("companies")} hint={tf("companiesHint")}>
          <MultiPicker id="rule-companies" label={tf("companies")} options={lookups.entities} value={draft.entityIds} onChange={(entityIds) => patch({ entityIds })} />
        </Field>
        <Field label={tf("sources")} hint={tf("sourcesHint")}>
          <MultiPicker id="rule-sources" label={tf("sources")} options={lookups.sources} value={draft.sources} onChange={(sources) => patch({ sources })} />
        </Field>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium text-oboya-blue-dark">{tf("target")}</legend>
          <div role="radiogroup" aria-label={tf("target")} className="grid gap-2 sm:grid-cols-2">
            {(["user", "round_robin"] as const).map((type) => (
              <label
                key={type}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm text-oboya-blue-dark ${
                  draft.targetType === type ? "border-oboya-blue/50 bg-oboya-blue/5" : "border-border/60"
                }`}
              >
                <input
                  type="radio"
                  name="rule-target"
                  className="accent-[var(--oboya-blue)]"
                  checked={draft.targetType === type}
                  onChange={() => patch({ targetType: type })}
                />
                {type === "user" ? tf("targetUserOption") : tf("targetPoolOption")}
              </label>
            ))}
          </div>
          {draft.targetType === "user" ? (
            <Field label={tf("targetUser")} htmlFor="rule-user">
              <select
                id="rule-user"
                className={selectClass}
                value={draft.targetUserId ?? ""}
                onChange={(e) => patch({ targetUserId: e.target.value || null })}
              >
                <option value="">{tf("selectUser")}</option>
                {users.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label={tf("pool")} hint={tf("poolHint")}>
              <MultiPicker
                id="rule-pool"
                label={tf("pool")}
                options={users}
                value={draft.poolUserIds}
                max={MAX_POOL_USERS}
                onChange={(poolUserIds) => patch({ poolUserIds })}
              />
            </Field>
          )}
        </fieldset>

        <div className="space-y-4 border-t border-border/60 pt-4">
          <SwitchRow id="rule-stop" label={tf("stop")} hint={tf("stopHint")}>
            <Switch id="rule-stop" checked={draft.stopProcessing} onCheckedChange={(stopProcessing) => patch({ stopProcessing })} />
          </SwitchRow>
          <SwitchRow id="rule-notify" label={tf("notify")}>
            <Switch id="rule-notify" checked={draft.notifyAssignee} onCheckedChange={(notifyAssignee) => patch({ notifyAssignee })} />
          </SwitchRow>
          <SwitchRow id="rule-active" label={tf("active")}>
            <Switch id="rule-active" checked={draft.active} onCheckedChange={(active) => patch({ active })} />
          </SwitchRow>
        </div>

        <section className="space-y-3 rounded-xl border border-border/60 bg-oboya-soft-white/60 p-3" aria-labelledby="rule-estimate-title">
          <div>
            <h3 id="rule-estimate-title" className="text-sm font-semibold text-oboya-blue-dark">{tp("title")}</h3>
            <p className="text-xs text-muted-foreground">{tp("description")}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label={tp("country")} htmlFor="est-country">
              <select id="est-country" className={selectClass} value={sample.countryCode} onChange={(e) => setSample((s) => ({ ...s, countryCode: e.target.value }))}>
                <option value="">{tp("any")}</option>
                {countryFlagOptions.map((c) => (
                  <option key={c.code} value={c.code}>{countryName(c.code, locale, c.label)}</option>
                ))}
              </select>
            </Field>
            <Field label={tp("company")} htmlFor="est-company">
              <select id="est-company" className={selectClass} value={sample.entityId} onChange={(e) => setSample((s) => ({ ...s, entityId: e.target.value }))}>
                <option value="">{tp("any")}</option>
                {lookups.entities.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
            <Field label={tp("source")} htmlFor="est-source">
              <select id="est-source" className={selectClass} value={sample.source} onChange={(e) => setSample((s) => ({ ...s, source: e.target.value }))}>
                <option value="">{tp("any")}</option>
                {lookups.sources.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Field>
          </div>
          <p role="status" aria-live="polite" className="text-sm text-oboya-blue-dark">
            {estimateOwner
              ? tp(estimate.via === "round_robin" ? "resultRound" : "result", { name: estimateOwner })
              : tp("none")}
          </p>
        </section>
      </div>
    </FormDrawer>
  );
}
