"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/crm/common/states";
import { StatusPill } from "@/components/crm/common/StatusPill";
import { LeadAssignmentSetup } from "@/components/crm/setup/LeadAssignmentSetup";
import { Field, SortableList, apiFetch, selectClass, useErrorMessage, useSetupData } from "@/components/crm/setup/shared";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { countryFlagOptions } from "@/constants/country-flags";
import { useCrm } from "@/contexts/CrmContext";
import {
  AUTOMATION_API,
  type AssignmentPreviewResponse,
  type AssignmentRulesResponse,
} from "@/lib/crm/automation/api-contract";
import type { AssignmentPreviewResult, AssignmentRule } from "@/lib/crm/automation/types";
import { RuleEditor } from "./RuleEditor";
import { countryName, type AutomationLookups } from "./shared";

const MAX_CHIPS = 3;

function Chips({ label, items }: { label: string; items: string[] }) {
  const t = useTranslations("automation.assignment");
  if (items.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {items.slice(0, MAX_CHIPS).map((i) => (
        <StatusPill key={i} tone="neutral" size="xs">
          {i}
        </StatusPill>
      ))}
      {items.length > MAX_CHIPS ? (
        <StatusPill tone="muted" size="xs">
          {t("more", { count: items.length - MAX_CHIPS })}
        </StatusPill>
      ) : null}
    </span>
  );
}

export function AssignmentRulesTab({ lookups }: { lookups: AutomationLookups }) {
  const t = useTranslations("automation");
  const locale = useLocale();
  const errorMessage = useErrorMessage();
  const { can } = useCrm();
  const canEdit = can("automation", "edit");
  const canCreate = can("automation", "create");
  const canDelete = can("automation", "delete");
  const { data, setData, error, loading, reload } = useSetupData<AssignmentRulesResponse>(AUTOMATION_API.assignmentRules);
  const [editing, setEditing] = useState<AssignmentRule | "new" | null>(null);

  const rules = data?.rules ?? [];
  const userName = useMemo(() => new Map(lookups.users.map((u) => [u.value, u.label])), [lookups.users]);
  const entityName = useMemo(() => new Map(lookups.entities.map((e) => [e.value, e.label])), [lookups.entities]);
  const sourceName = useMemo(() => new Map(lookups.sources.map((s) => [s.value, s.label])), [lookups.sources]);
  const countryLabel = (code: string) =>
    countryName(code, locale, countryFlagOptions.find((c) => c.code === code)?.label);

  const reorder = async (ids: string[]) => {
    if (!data) return;
    const byId = new Map(rules.map((r) => [r.id, r]));
    const previous = data;
    setData({ rules: ids.map((id) => byId.get(id)!).filter(Boolean) });
    try {
      await apiFetch(AUTOMATION_API.assignmentRulesReorder, { method: "POST", body: JSON.stringify({ ids }) });
    } catch (e) {
      setData(previous);
      toast.error(errorMessage(e));
    }
  };

  const toggleActive = async (rule: AssignmentRule, active: boolean) => {
    if (!data) return;
    setData({ rules: rules.map((r) => (r.id === rule.id ? { ...r, active } : r)) });
    try {
      await apiFetch(AUTOMATION_API.assignmentRule(rule.id), { method: "PATCH", body: JSON.stringify({ active }) });
    } catch (e) {
      toast.error(errorMessage(e));
      void reload();
    }
  };

  const remove = async (rule: AssignmentRule) => {
    if (!window.confirm(t("common.confirmDelete", { name: rule.name }))) return;
    try {
      await apiFetch(AUTOMATION_API.assignmentRule(rule.id), { method: "DELETE" });
      toast.success(t("common.deleted"));
      void reload();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const targetSummary = (r: AssignmentRule) =>
    r.targetType === "user"
      ? t("assignment.targetUser", { name: (r.targetUserId && userName.get(r.targetUserId)) || t("common.unknownUser") })
      : t("assignment.targetPool", { count: r.poolUserIds.length });

  return (
    <div className="space-y-6">
      <section className="space-y-3" aria-labelledby="assignment-rules-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="assignment-rules-title" className="text-base font-semibold text-oboya-blue-dark">
              {t("assignment.title")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("assignment.description")}</p>
          </div>
          {canCreate ? (
            <Button type="button" onClick={() => setEditing("new")} className="min-h-11 md:min-h-8">
              <Plus className="size-4" aria-hidden /> {t("assignment.add")}
            </Button>
          ) : null}
        </div>
        {!canEdit ? <p className="text-xs text-muted-foreground">{t("common.readOnly")}</p> : null}

        {error && !data ? (
          <ErrorState message={errorMessage(error)} onRetry={() => void reload()} />
        ) : loading && !data ? (
          <ListSkeleton rows={3} />
        ) : rules.length === 0 ? (
          <EmptyState title={t("assignment.emptyTitle")} description={t("assignment.emptyDescription")} />
        ) : (
          <SortableList
            items={rules}
            disabled={!canEdit}
            onReorder={(ids) => void reorder(ids)}
            itemLabel={(r) => r.name}
            renderItem={(rule, index) => {
              const countries = rule.countryCodes.map(countryLabel);
              const companies = rule.entityIds.map((id) => entityName.get(id) ?? id);
              const sources = rule.sources.map((s) => sourceName.get(s) ?? s);
              const none = !countries.length && !companies.length && !sources.length;
              return (
                <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                  <span className="mt-0.5 w-5 shrink-0 text-xs font-semibold text-muted-foreground" aria-hidden>
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className={`truncate text-sm font-medium ${rule.active ? "text-oboya-blue-dark" : "text-muted-foreground"}`}>
                      {rule.name}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      {none ? <span className="text-xs text-muted-foreground">{t("assignment.anyCriteria")}</span> : null}
                      <Chips label={t("assignment.criteria.countries")} items={countries} />
                      <Chips label={t("assignment.criteria.companies")} items={companies} />
                      <Chips label={t("assignment.criteria.sources")} items={sources} />
                    </div>
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-oboya-blue-dark/80">
                      {targetSummary(rule)}
                      {rule.stopProcessing ? <StatusPill tone="warning" size="xs">{t("assignment.stopChip")}</StatusPill> : null}
                      {rule.notifyAssignee ? <StatusPill tone="info" size="xs">{t("assignment.notifyChip")}</StatusPill> : null}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Switch
                      checked={rule.active}
                      onCheckedChange={(v) => void toggleActive(rule, v)}
                      disabled={!canEdit}
                      aria-label={rule.name}
                      id={`rule-active-${rule.id}`}
                    />
                    {canEdit ? (
                      <button
                        type="button"
                        onClick={() => setEditing(rule)}
                        aria-label={`${t("common.edit")}: ${rule.name}`}
                        className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted md:min-h-8 md:min-w-8"
                      >
                        <Pencil className="size-4" />
                      </button>
                    ) : null}
                    {canDelete ? (
                      <button
                        type="button"
                        onClick={() => void remove(rule)}
                        aria-label={`${t("common.delete")}: ${rule.name}`}
                        className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-oboya-orange hover:bg-oboya-orange/10 md:min-h-8 md:min-w-8"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            }}
          />
        )}
      </section>

      <RulePreview lookups={lookups} rules={rules} />

      {lookups.canViewFallback ? (
        <section aria-labelledby="assignment-fallback-title" className="space-y-3">
          <div>
            <h2 id="assignment-fallback-title" className="text-base font-semibold text-oboya-blue-dark">
              {t("assignment.fallback.title")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("assignment.fallback.description")}</p>
          </div>
          <LeadAssignmentSetup embedded />
        </section>
      ) : null}

      <RuleEditor
        rule={editing && editing !== "new" ? editing : null}
        open={editing !== null}
        lookups={lookups}
        rules={rules}
        onClose={() => setEditing(null)}
        onSaved={() => void reload()}
      />
    </div>
  );
}

/** Live "This lead would go to..." check against the saved rules. */
function RulePreview({ lookups, rules }: { lookups: AutomationLookups; rules: AssignmentRule[] }) {
  const t = useTranslations("automation.assignment.preview");
  const locale = useLocale();
  const [countryCode, setCountryCode] = useState("");
  const [entityId, setEntityId] = useState("");
  const [source, setSource] = useState("");
  const [state, setState] = useState<{ key: string; result?: AssignmentPreviewResult; failed?: boolean } | null>(null);
  const key = [countryCode, entityId, source, rules.map((r) => `${r.id}:${r.sortOrder}:${r.active}:${r.updatedAt}`).join()].join("|");

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      apiFetch<AssignmentPreviewResponse>(AUTOMATION_API.assignmentRulesPreview, {
        method: "POST",
        quiet: true,
        body: JSON.stringify({ countryCode: countryCode || null, entityId: entityId || null, source: source || null }),
      })
        .then((r) => !cancelled && setState({ key, result: r.result }))
        .catch(() => !cancelled && setState({ key, failed: true }));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, countryCode, entityId, source]);

  const current = state?.key === key ? state : null;
  const result = current?.result;
  const owner = result?.ownerId ? lookups.users.find((u) => u.value === result.ownerId)?.label : null;
  const ruleName = result?.ruleId ? rules.find((r) => r.id === result.ruleId)?.name : null;

  return (
    <section className="space-y-3 rounded-xl border border-border/60 bg-white p-4 sm:p-5" aria-labelledby="assignment-preview-title">
      <div>
        <h2 id="assignment-preview-title" className="text-base font-semibold text-oboya-blue-dark">
          {t("title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("country")} htmlFor="preview-country">
          <select id="preview-country" className={selectClass} value={countryCode} onChange={(e) => setCountryCode(e.target.value)}>
            <option value="">{t("anyOption")}</option>
            {countryFlagOptions.map((c) => (
              <option key={c.code} value={c.code}>
                {countryName(c.code, locale, c.label)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("company")} htmlFor="preview-company">
          <select id="preview-company" className={selectClass} value={entityId} onChange={(e) => setEntityId(e.target.value)}>
            <option value="">{t("anyOption")}</option>
            {lookups.entities.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("source")} htmlFor="preview-source">
          <select id="preview-source" className={selectClass} value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">{t("anyOption")}</option>
            {lookups.sources.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div role="status" aria-live="polite" className="rounded-lg bg-oboya-soft-white px-3 py-2.5 text-sm text-oboya-blue-dark">
        {!current ? (
          <span className="text-muted-foreground">{t("running")}</span>
        ) : current.failed ? (
          <span className="text-oboya-orange">{t("failed")}</span>
        ) : !owner ? (
          t("resultNone")
        ) : (
          <>
            <p className="font-medium">
              {ruleName ? t("resultRule", { name: owner, rule: ruleName }) : t("result", { name: owner })}
            </p>
            {result ? <p className="text-xs text-muted-foreground">{t(`via.${result.via}`)}</p> : null}
          </>
        )}
      </div>
    </section>
  );
}
