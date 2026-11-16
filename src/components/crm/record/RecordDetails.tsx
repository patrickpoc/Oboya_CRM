"use client";

import { useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useUnsavedChangesGuard } from "@/components/crm/common/unsaved-changes";
import { fieldSchema } from "@/lib/crm/objects/schema";
import type { FieldConfig, RecordConfig, RecordLookups, RecordRow } from "@/lib/crm/objects/types";
import { cn } from "@/lib/utils";
import { FieldInput } from "./FieldInput";
import { FieldValue } from "./FieldValue";

/**
 * Details tab: two-column grid, inline edit per field (pencil → input →
 * save/cancel). `onSave` performs the optimistic PATCH and resolves to success.
 */
export function RecordDetails({
  config,
  record,
  lookups,
  canEdit,
  onSave,
}: {
  config: RecordConfig;
  record: RecordRow;
  lookups: RecordLookups;
  canEdit: boolean;
  onSave: (key: string, value: unknown, display?: string) => Promise<boolean>;
}) {
  const t = useTranslations();
  const tr = useTranslations("record");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<unknown>(null);
  const [draftLabel, setDraftLabel] = useState<string | undefined>();
  const [invalid, setInvalid] = useState(false);
  const [saving, setSaving] = useState(false);

  const dirty = editing !== null && JSON.stringify(draft ?? null) !== JSON.stringify(record[editing] ?? null);
  useUnsavedChangesGuard(dirty);

  const start = (field: FieldConfig) => {
    if (dirty && !window.confirm(t("shell.leaveUnsavedConfirm"))) return;
    setEditing(field.key);
    setDraft(record[field.key] ?? null);
    setDraftLabel(record._display?.[field.key]);
    setInvalid(false);
  };
  const cancel = () => {
    setEditing(null);
    setInvalid(false);
  };
  const save = async (field: FieldConfig) => {
    const parsed = fieldSchema(field, "update").safeParse(draft);
    if (!parsed.success || (field.required && parsed.data == null)) {
      setInvalid(true);
      return;
    }
    if (!dirty) return cancel();
    setSaving(true);
    const ok = await onSave(field.key, parsed.data, draftLabel);
    setSaving(false);
    if (ok) cancel();
  };

  const fields = config.fields.filter((f) => !f.hideInDetails);

  return (
    <dl className="grid gap-x-6 sm:grid-cols-2">
      {fields.map((field) => {
        const isEditing = editing === field.key;
        const editable = canEdit && field.editable !== false;
        const id = `detail-${field.key}`;
        return (
          <div
            key={field.key}
            className={cn(
              "group min-w-0 border-b border-border/50 py-2.5",
              (field.wide || field.type === "textarea") && "sm:col-span-2"
            )}
          >
            <dt className="text-xs font-medium text-muted-foreground">
              <label htmlFor={isEditing ? id : undefined}>{t(`${config.namespace}.${field.labelKey}`)}</label>
            </dt>
            <dd className="mt-1 text-sm text-oboya-blue-dark">
              {isEditing ? (
                <form
                  className="space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save(field);
                  }}
                  onKeyDown={(e) => e.key === "Escape" && cancel()}
                >
                  <FieldInput
                    config={config}
                    field={field}
                    id={id}
                    value={draft}
                    displayLabel={draftLabel}
                    lookups={lookups}
                    invalid={invalid}
                    recordId={record.id}
                    onChange={(value, label) => {
                      setDraft(value);
                      if (label !== undefined) setDraftLabel(label);
                      setInvalid(false);
                    }}
                  />
                  {invalid ? (
                    <p className="text-xs text-oboya-orange" role="alert">
                      {tr("fieldInvalid")}
                    </p>
                  ) : null}
                  <div className="flex gap-2">
                    <Button type="submit" size="sm" className="rounded-full bg-oboya-blue text-white hover:bg-oboya-blue/90" disabled={saving}>
                      <Check /> {saving ? tr("saving") : tr("actions.save")}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className="rounded-full" onClick={cancel} disabled={saving}>
                      <X /> {tr("actions.cancel")}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex min-h-6 items-start justify-between gap-2">
                  <FieldValue config={config} field={field} row={record} lookups={lookups} />
                  {editable ? (
                    <button
                      type="button"
                      onClick={() => start(field)}
                      aria-label={tr("fieldEdit", { field: t(`${config.namespace}.${field.labelKey}`) })}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:bg-oboya-soft-white hover:text-oboya-blue-dark md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                  ) : null}
                </div>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
