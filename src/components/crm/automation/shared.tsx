"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import type { Option, UserOption } from "@/lib/crm/objects/types";
import type { SlaHours } from "@/lib/crm/leads/sla";
import { cn } from "@/lib/utils";

export type PipelineOption = {
  id: string;
  name: string;
  isDefault: boolean;
  stages: { id: string; label: string; active: boolean }[];
};

/** Lookups loaded by the server page and passed to every tab. */
export type AutomationLookups = {
  users: UserOption[];
  entities: Option[];
  sources: Option[];
  pipelines: PipelineOption[];
  slaHours: SlaHours;
  canViewFallback: boolean;
};

/** Searchable checkbox list for multi-selects (countries, companies, sources, pool). */
export function MultiPicker({
  id,
  label,
  options,
  value,
  onChange,
  disabled,
  max,
}: {
  id: string;
  label: string;
  options: (Option & { hint?: string })[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  max?: number;
}) {
  const t = useTranslations("automation.assignment.picker");
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  }, [options, q]);
  const selected = new Set(value);
  const toggle = (v: string) => {
    if (selected.has(v)) onChange(value.filter((x) => x !== v));
    else if (!max || value.length < max) onChange([...value, v]);
  };

  return (
    <div className="space-y-2" role="group" aria-labelledby={`${id}-label`}>
      <span id={`${id}-label`} className="sr-only">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("search")}
          aria-label={`${label}: ${t("search")}`}
          className="h-9"
        />
        <span className="shrink-0 text-xs text-muted-foreground" aria-live="polite">
          {t("selected", { count: value.length })}
        </span>
        {value.length > 0 && !disabled ? (
          <button
            type="button"
            onClick={() => onChange([])}
            className="min-h-11 shrink-0 rounded px-2 text-xs text-oboya-blue hover:underline md:min-h-8"
          >
            {t("clear")}
          </button>
        ) : null}
      </div>
      <ul className="max-h-44 divide-y divide-border/40 overflow-y-auto rounded-lg border border-border/60 bg-white">
        {filtered.length === 0 ? (
          <li className="px-3 py-2 text-xs text-muted-foreground">{t("noResults")}</li>
        ) : (
          filtered.map((o) => (
            <li key={o.value}>
              <label
                className={cn(
                  "flex min-h-11 cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm text-oboya-blue-dark hover:bg-oboya-soft-white md:min-h-9",
                  disabled && "cursor-not-allowed opacity-60"
                )}
              >
                <input
                  type="checkbox"
                  className="size-4 accent-[var(--oboya-blue)]"
                  checked={selected.has(o.value)}
                  disabled={disabled}
                  onChange={() => toggle(o.value)}
                />
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.hint ? <span className="text-xs text-muted-foreground">{o.hint}</span> : null}
              </label>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

/** Label + switch row. */
export function SwitchRow({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-medium text-oboya-blue-dark">
          {label}
        </label>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}

export const inputClass = "h-9";

/** Locale-aware country display name for an ISO-2 code. */
export function countryName(code: string, locale: string, fallback?: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? fallback ?? code;
  } catch {
    return fallback ?? code;
  }
}
