"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const inputClass = "h-8 w-[8.5rem] rounded-md border bg-white px-2 text-xs text-oboya-blue-dark";

/** Inclusive date range filter; value is "from..to" (either side may be empty), "" = none. */
export function DateRangeFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const t = useTranslations("listViews");
  const [from = "", to = ""] = value.includes("..") ? value.split("..") : [value, value];
  const set = (nextFrom: string, nextTo: string) => onChange(nextFrom || nextTo ? `${nextFrom}..${nextTo}` : "");
  return (
    <fieldset className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <legend className="sr-only">{label}</legend>
      <span aria-hidden className="whitespace-nowrap">{label}</span>
      <input
        type="date"
        aria-label={t("rangeFrom", { field: label })}
        value={from}
        max={to || undefined}
        onChange={(e) => set(e.target.value, to)}
        className={cn(inputClass, from ? "border-oboya-blue/50" : "border-border/70")}
      />
      <span aria-hidden>–</span>
      <input
        type="date"
        aria-label={t("rangeTo", { field: label })}
        value={to}
        min={from || undefined}
        onChange={(e) => set(from, e.target.value)}
        className={cn(inputClass, to ? "border-oboya-blue/50" : "border-border/70")}
      />
    </fieldset>
  );
}
