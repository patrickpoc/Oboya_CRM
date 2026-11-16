"use client";

import Link from "next/link";
import { Star } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { StatusPill } from "@/components/crm/common/StatusPill";
import { CountryFlag } from "@/components/ui/country-flag";
import {
  OBJECT_META,
  lookupTarget,
  type EntityLink,
  type FieldConfig,
  type RecordConfig,
  type RecordLookups,
  type RecordRow,
} from "@/lib/crm/objects/types";
import { cn } from "@/lib/utils";

export function Empty() {
  return <span className="text-muted-foreground">—</span>;
}

/** Label of a static option, a DB picklist value, or the raw value. */
export function useOptionLabel(config: RecordConfig, lookups: RecordLookups) {
  const t = useTranslations();
  return (field: FieldConfig, value: string) => {
    if (field.picklist?.kind === "static") {
      const option = field.picklist.options.find((o) => o.value === value);
      return option ? t(`${config.namespace}.${option.labelKey}`) : value;
    }
    if (field.picklist?.kind === "picklist") {
      return lookups.picklists[field.picklist.picklist]?.find((o) => o.value === value)?.label ?? value;
    }
    if (field.picklist?.kind === "stages") return lookups.stages.find((s) => s.value === value)?.label ?? value;
    return value;
  };
}

/** Read-only rendering of any field type. */
export function FieldValue({
  config,
  field,
  row,
  lookups,
  className,
}: {
  config: RecordConfig;
  field: FieldConfig;
  row: RecordRow;
  lookups: RecordLookups;
  className?: string;
}) {
  const format = useFormatter();
  const t = useTranslations("record");
  const optionLabel = useOptionLabel(config, lookups);
  const value = row[field.key];
  const display = row._display?.[field.key];

  if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) {
    return <Empty />;
  }

  const wrap = (node: React.ReactNode) => <span className={cn("min-w-0 break-words", className)}>{node}</span>;

  switch (field.type) {
    case "email":
      return wrap(
        <a href={`mailto:${value}`} className="text-oboya-blue-light hover:underline" onClick={(e) => e.stopPropagation()}>
          {String(value)}
        </a>
      );
    case "phone":
      return wrap(
        <a href={`tel:${value}`} className="text-oboya-blue-light hover:underline" onClick={(e) => e.stopPropagation()}>
          {String(value)}
        </a>
      );
    case "url":
      return wrap(
        <a
          href={String(value)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-oboya-blue-light hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {String(value).replace(/^https?:\/\//, "")}
        </a>
      );
    case "textarea":
      return wrap(<span className="whitespace-pre-wrap">{String(value)}</span>);
    case "number":
      return wrap(format.number(Number(value)));
    case "currency": {
      const currency = (field.currencyField && typeof row[field.currencyField] === "string"
        ? (row[field.currencyField] as string)
        : "USD");
      return wrap(<span className="tabular-nums">{format.number(Number(value), { style: "currency", currency })}</span>);
    }
    case "percent":
      return wrap(`${format.number(Number(value))}%`);
    case "date":
      return wrap(format.dateTime(new Date(`${value}T00:00:00Z`), { dateStyle: "medium", timeZone: "UTC" }));
    case "datetime":
      return wrap(format.dateTime(new Date(String(value)), { dateStyle: "medium", timeStyle: "short" }));
    case "boolean":
      return wrap(value ? t("yes") : t("no"));
    case "picklist": {
      const label = display ?? optionLabel(field, String(value));
      const tone = field.picklist?.kind === "static"
        ? field.picklist.options.find((o) => o.value === value)?.tone
        : undefined;
      return wrap(tone ? <StatusPill tone={tone}>{label}</StatusPill> : label);
    }
    case "multipicklist":
    case "tags":
      return wrap(
        <span className="flex flex-wrap gap-1">
          {(value as string[]).map((v) => (
            <StatusPill key={v} tone="neutral" size="xs">
              {optionLabel(field, v)}
            </StatusPill>
          ))}
        </span>
      );
    case "lookup": {
      const targetObject = lookupTarget(field, row);
      const target = targetObject ? OBJECT_META[targetObject] : null;
      if (!display || !target) return <Empty />;
      return wrap(
        <Link
          href={`${target.basePath}/${value}`}
          className="font-medium text-oboya-blue-light hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {display}
        </Link>
      );
    }
    case "owner":
      return wrap(display ?? lookups.users.find((u) => u.value === value)?.label ?? <Empty />);
    case "entity": {
      if (!field.multiple) return wrap(display ?? lookups.entities.find((e) => e.value === value)?.label ?? <Empty />);
      const names = new Map(lookups.entities.map((e) => [e.value, e.label]));
      return wrap(
        <span className="flex flex-wrap gap-1">
          {(value as EntityLink[]).map((link) => (
            <StatusPill key={link.entityId} tone={link.isPrimary ? "brand" : "neutral"} size="xs">
              {link.isPrimary ? <Star className="size-2.5 fill-current" aria-label={t("primary")} /> : null}
              {names.get(link.entityId) ?? "—"}
            </StatusPill>
          ))}
        </span>
      );
    }
    case "country":
      return wrap(
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-[18px] overflow-hidden rounded-[2px]">
            <CountryFlag code={String(value)} />
          </span>
          {String(value)}
        </span>
      );
    default:
      return wrap(display ?? String(value));
  }
}
