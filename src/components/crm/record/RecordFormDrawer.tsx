"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { FormDrawer } from "@/components/crm/forms/FormDrawer";
import { useUnsavedChangesGuard } from "@/components/crm/common/unsaved-changes";
import { useCrm } from "@/contexts/CrmContext";
import { getRecordConfig } from "@/lib/crm/objects/registry";
import { buildSchema, fieldErrors, writableFields } from "@/lib/crm/objects/schema";
import type { CrmObject, RecordLookups, RecordRow } from "@/lib/crm/objects/types";
import { cn } from "@/lib/utils";
import { ApiError, createRecord, useApiErrorMessage } from "./api";
import { FieldInput } from "./FieldInput";

/**
 * Generic create form built from the object's RecordConfig. `defaults` prefill
 * values (e.g. the foreign key of a related list). Navigates to the new record
 * unless `onCreated` is given.
 */
export function RecordFormDrawer({
  object,
  open,
  onClose,
  lookups,
  defaults,
  defaultLabels,
  onCreated,
}: {
  object: CrmObject;
  open: boolean;
  onClose: () => void;
  lookups: RecordLookups;
  defaults?: Record<string, unknown>;
  /** Display labels for prefilled lookups, e.g. { account_id: "Acme" }. */
  defaultLabels?: Record<string, string>;
  onCreated?: (record: RecordRow) => void;
}) {
  if (!open) return null;
  return (
    <RecordFormDrawerBody
      object={object}
      onClose={onClose}
      lookups={lookups}
      defaults={defaults}
      defaultLabels={defaultLabels}
      onCreated={onCreated}
    />
  );
}

function RecordFormDrawerBody({
  object,
  onClose,
  lookups,
  defaults,
  defaultLabels,
  onCreated,
}: {
  object: CrmObject;
  onClose: () => void;
  lookups: RecordLookups;
  defaults?: Record<string, unknown>;
  defaultLabels?: Record<string, string>;
  onCreated?: (record: RecordRow) => void;
}) {
  const config = getRecordConfig(object)!;
  const t = useTranslations();
  const tr = useTranslations("record");
  const router = useRouter();
  const { user } = useCrm();
  const errorMessage = useApiErrorMessage();
  const fields = useMemo(() => writableFields(config, "create"), [config]);

  const initial = useMemo(() => {
    const values: Record<string, unknown> = {};
    for (const f of fields) {
      if (f.defaultValue !== undefined) values[f.key] = f.defaultValue;
      else if (f.type === "owner" && f.key === "owner_id") values[f.key] = user.id;
    }
    return { ...values, ...(defaults ?? {}) };
  }, [fields, defaults, user.id]);

  const [values, setValues] = useState<Record<string, unknown>>(initial);
  const [labels, setLabels] = useState<Record<string, string>>(defaultLabels ?? {});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  useUnsavedChangesGuard(dirty);

  const close = () => {
    if (dirty && !window.confirm(t("shell.leaveUnsavedConfirm"))) return;
    onClose();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = buildSchema(config, "create").safeParse(values);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const { record } = await createRecord(object, parsed.data);
      toast.success(tr("toast.created", { name: record._display?._name ?? "" }));
      onClose();
      if (onCreated) onCreated(record);
      else router.push(`${config.basePath}/${record.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.fields) setErrors(error.fields);
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const formId = `create-${object}`;
  return (
    <FormDrawer
      open
      onClose={close}
      width="lg"
      title={tr("createTitle", { object: tr(`objects.${object}`) })}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" className="rounded-full" onClick={close} disabled={saving}>
            {tr("actions.cancel")}
          </Button>
          <Button
            type="submit"
            form={formId}
            className="rounded-full bg-oboya-blue text-white hover:bg-oboya-blue/90"
            disabled={saving}
          >
            {saving ? tr("saving") : tr("actions.save")}
          </Button>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {fields.map((field) => {
          const id = `${formId}-${field.key}`;
          const error = errors[field.key];
          return (
            <div key={field.key} className={cn("min-w-0 space-y-1.5", (field.wide || field.type === "textarea") && "sm:col-span-2")}>
              <Label htmlFor={id}>
                {t(`${config.namespace}.${field.labelKey}`)}
                {field.required ? <span className="text-oboya-orange"> *</span> : null}
              </Label>
              <FieldInput
                config={config}
                field={field}
                id={id}
                value={values[field.key] ?? null}
                displayLabel={labels[field.key]}
                invalid={Boolean(error)}
                lookups={lookups}
                onChange={(value, display) => {
                  setValues((prev) => ({ ...prev, [field.key]: value }));
                  if (display !== undefined) setLabels((prev) => ({ ...prev, [field.key]: display }));
                }}
              />
              {error ? (
                <p className="text-xs text-oboya-orange" role="alert">
                  {tr("fieldInvalid")}
                </p>
              ) : null}
            </div>
          );
        })}
      </form>
    </FormDrawer>
  );
}
