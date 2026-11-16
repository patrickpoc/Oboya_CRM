"use client";

import { useState } from "react";
import { Star, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { CountryFlag } from "@/components/ui/country-flag";
import { countryFlagOptions } from "@/constants/country-flags";
import type {
  EntityLink,
  FieldConfig,
  Option,
  RecordConfig,
  RecordLookups,
} from "@/lib/crm/objects/types";
import { cn } from "@/lib/utils";
import { LookupCombobox } from "./LookupCombobox";

const selectClass =
  "h-9 w-full rounded-md border bg-white px-2 text-sm text-oboya-blue-dark outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

/** Options for picklist-like fields (static i18n labels or DB picklist rows). */
export function useFieldOptions(config: RecordConfig, lookups: RecordLookups) {
  const t = useTranslations();
  return (field: FieldConfig): Option[] => {
    if (field.picklist?.kind === "static") {
      return field.picklist.options.map((o) => ({ value: o.value, label: t(`${config.namespace}.${o.labelKey}`) }));
    }
    if (field.picklist?.kind === "picklist") return lookups.picklists[field.picklist.picklist] ?? [];
    if (field.picklist?.kind === "stages") return lookups.stages;
    return [];
  };
}

function toLocalInput(iso: unknown): string {
  if (typeof iso !== "string" || !iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Keeps the current value selectable even when it is no longer an active option. */
function withCurrent(options: Option[], value: unknown, label?: string): Option[] {
  if (typeof value !== "string" || !value || options.some((o) => o.value === value)) return options;
  return [{ value, label: label ?? value }, ...options];
}

function ChipsInput({
  value,
  onChange,
  suggestions,
  id,
  invalid,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  suggestions: Option[];
  id?: string;
  invalid?: boolean;
}) {
  const t = useTranslations("record");
  const [draft, setDraft] = useState("");
  const labelOf = (v: string) => suggestions.find((s) => s.value === v)?.label ?? v;
  const add = (raw: string) => {
    const tag = raw.trim().toLowerCase();
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setDraft("");
  };
  return (
    <div
      className={cn(
        "flex min-h-9 flex-wrap items-center gap-1 rounded-md border bg-white px-2 py-1",
        invalid ? "border-oboya-orange" : "border-input"
      )}
    >
      {value.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded-full bg-oboya-soft-white px-2 py-0.5 text-xs text-oboya-blue-dark ring-1 ring-border/70">
          {labelOf(v)}
          <button type="button" onClick={() => onChange(value.filter((x) => x !== v))} aria-label={t("removeValue", { value: labelOf(v) })}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        list={suggestions.length ? `${id}-suggestions` : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => draft && add(draft)}
        placeholder={value.length ? "" : t("tagsPlaceholder")}
        className="min-w-24 flex-1 bg-transparent text-sm outline-none"
      />
      {suggestions.length ? (
        <datalist id={`${id}-suggestions`}>
          {suggestions.filter((s) => !value.includes(s.value)).map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </datalist>
      ) : null}
    </div>
  );
}

function MultiOptions({
  value,
  onChange,
  options,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  options: Option[];
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
            className={cn(
              "rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition-colors",
              on ? "bg-oboya-blue text-white ring-oboya-blue" : "bg-white text-oboya-blue-dark ring-border/70 hover:bg-oboya-soft-white"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function EntityLinksInput({
  value,
  onChange,
  entities,
}: {
  value: EntityLink[];
  onChange: (value: EntityLink[]) => void;
  entities: Option[];
}) {
  const t = useTranslations("record");
  const selected = new Map(value.map((l) => [l.entityId, l]));
  const toggle = (id: string) => {
    if (selected.has(id)) {
      const next = value.filter((l) => l.entityId !== id);
      if (selected.get(id)?.isPrimary && next.length) next[0] = { ...next[0], isPrimary: true };
      onChange(next);
    } else {
      onChange([...value, { entityId: id, isPrimary: value.length === 0 }]);
    }
  };
  const setPrimary = (id: string) => onChange(value.map((l) => ({ ...l, isPrimary: l.entityId === id })));
  return (
    <ul className="divide-y divide-border/50 rounded-md border border-input bg-white">
      {entities.map((e) => {
        const link = selected.get(e.value);
        return (
          <li key={e.value} className="flex items-center gap-2 px-3 py-2 text-sm">
            <label className="flex flex-1 items-center gap-2 text-oboya-blue-dark">
              <input type="checkbox" checked={Boolean(link)} onChange={() => toggle(e.value)} />
              {e.label}
            </label>
            {link ? (
              <button
                type="button"
                onClick={() => setPrimary(e.value)}
                aria-pressed={link.isPrimary}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                  link.isPrimary ? "bg-oboya-blue text-white" : "text-muted-foreground hover:text-oboya-blue-dark"
                )}
              >
                <Star className={cn("size-3", link.isPrimary && "fill-current")} />
                {link.isPrimary ? t("primary") : t("setPrimary")}
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Editor for any field type. `value` uses the API shape (see schema.ts). */
export function FieldInput({
  config,
  field,
  value,
  onChange,
  lookups,
  id,
  invalid,
  displayLabel,
  recordId,
}: {
  config: RecordConfig;
  field: FieldConfig;
  value: unknown;
  onChange: (value: unknown, display?: string) => void;
  lookups: RecordLookups;
  id?: string;
  invalid?: boolean;
  /** Current `_display` label (lookups). */
  displayLabel?: string;
  /** Excluded from self-lookups (e.g. parent account). */
  recordId?: string;
}) {
  const t = useTranslations("record");
  const options = useFieldOptions(config, lookups);
  const border = invalid ? "border-oboya-orange" : "border-input";
  const text = typeof value === "string" || typeof value === "number" ? String(value) : "";

  switch (field.type) {
    case "textarea":
      return (
        <Textarea id={id} value={text} rows={4} aria-invalid={invalid || undefined} onChange={(e) => onChange(e.target.value)} />
      );
    case "number":
    case "currency":
    case "percent":
      return (
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          step={field.type === "currency" ? "0.01" : field.type === "percent" ? "1" : "any"}
          min={field.type === "number" ? undefined : 0}
          max={field.type === "percent" ? 100 : undefined}
          value={text}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        />
      );
    case "date":
      return <Input id={id} type="date" value={text} aria-invalid={invalid || undefined} onChange={(e) => onChange(e.target.value || null)} />;
    case "datetime":
      return (
        <Input
          id={id}
          type="datetime-local"
          value={toLocalInput(value)}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
        />
      );
    case "boolean":
      return <Switch id={id} checked={value === true} onCheckedChange={(checked) => onChange(checked)} />;
    case "picklist": {
      const list = withCurrent(options(field), value, displayLabel);
      return (
        <select id={id} className={cn(selectClass, border)} value={text} onChange={(e) => onChange(e.target.value || null)}>
          {!field.required || !text ? <option value="">{t("select")}</option> : null}
          {list.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    case "multipicklist":
      return <MultiOptions value={Array.isArray(value) ? (value as string[]) : []} onChange={onChange} options={options(field)} />;
    case "tags":
      return (
        <ChipsInput
          id={id}
          invalid={invalid}
          value={Array.isArray(value) ? (value as string[]) : []}
          onChange={onChange}
          suggestions={options(field)}
        />
      );
    case "lookup":
      return field.lookup ? (
        <LookupCombobox
          id={id}
          object={field.lookup}
          value={typeof value === "string" ? value : null}
          label={displayLabel}
          invalid={invalid}
          excludeId={field.lookup === config.object ? recordId : undefined}
          onChange={(next, label) => onChange(next, label)}
        />
      ) : null;
    case "owner": {
      const users = withCurrent(
        lookups.users.filter((u) => u.active || u.value === value),
        value,
        displayLabel
      );
      return (
        <select id={id} className={cn(selectClass, border)} value={text} onChange={(e) => onChange(e.target.value || null)}>
          {!text ? <option value="">{t("select")}</option> : null}
          {users.map((u) => (
            <option key={u.value} value={u.value}>
              {u.label}
            </option>
          ))}
        </select>
      );
    }
    case "entity":
      if (field.multiple) {
        return (
          <EntityLinksInput
            value={Array.isArray(value) ? (value as EntityLink[]) : []}
            onChange={onChange}
            entities={lookups.entities}
          />
        );
      }
      return (
        <select id={id} className={cn(selectClass, border)} value={text} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">{t("select")}</option>
          {withCurrent(lookups.entities, value, displayLabel).map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </select>
      );
    case "country": {
      const list = withCurrent(
        countryFlagOptions.map((c) => ({ value: c.code as string, label: `${c.label} (${c.code})` })),
        value
      );
      return (
        <div className="flex items-center gap-2">
          <span className="inline-block h-4 w-6 shrink-0 overflow-hidden rounded-[2px] bg-muted">
            {text ? <CountryFlag code={text} /> : null}
          </span>
          <select id={id} className={cn(selectClass, border)} value={text} onChange={(e) => onChange(e.target.value || null)}>
            <option value="">{t("select")}</option>
            {list.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      );
    }
    default:
      return (
        <Input
          id={id}
          type={field.type === "email" ? "email" : field.type === "phone" ? "tel" : field.type === "url" ? "url" : "text"}
          inputMode={field.type === "phone" ? "tel" : undefined}
          maxLength={field.max ?? 255}
          value={text}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
