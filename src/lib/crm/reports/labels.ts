import type { FieldConfig, RecordConfig, RecordLookups } from "@/lib/crm/objects/types";
import { bucketLabel } from "./buckets";
import type { ReportBucket } from "./definition";

/** next-intl-like translator over full keys (`reports.engine.empty`, `leads.options.new`). */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

const FALLBACKS: Record<string, string> = {
  "reports.engine.restricted": "(restricted)",
  "reports.engine.empty": "(none)",
  "reports.engine.total": "Total",
  "record.yes": "Yes",
  "record.no": "No",
};

/** Translator used when the caller passes none (tests, scripts): English fallbacks, else the key tail. */
export const fallbackTranslate: Translate = (key) => FALLBACKS[key] ?? key.split(".").pop() ?? key;

export type LabelContext = {
  config: RecordConfig;
  lookups: RecordLookups;
  /** id -> name of the lookup records the viewer can read. */
  lookupNames: ReadonlyMap<string, string>;
  t: Translate;
  locale: string;
};

/**
 * Label of one group key. References the viewer cannot read (not in the
 * lookups, filtered out by RLS) read "(restricted)": never the raw id.
 */
export function makeLabeler(ctx: LabelContext) {
  const { config, lookups, lookupNames, t, locale } = ctx;
  const restricted = () => t("reports.engine.restricted");

  const resolve = (field: FieldConfig, key: string, bucket?: ReportBucket): { text: string; restricted: boolean } => {
    const ok = (text: string) => ({ text, restricted: false });
    const hidden = () => ({ text: restricted(), restricted: true });
    if (key === "") return ok(t("reports.engine.empty"));
    if (bucket && (field.type === "date" || field.type === "datetime")) return ok(bucketLabel(key, bucket, locale));
    const found = (text: string | undefined) => (text === undefined ? hidden() : ok(text));
    switch (field.type) {
      case "boolean":
        return ok(t(key === "true" ? "record.yes" : "record.no"));
      case "owner":
        return found(lookups.users.find((u) => u.value === key)?.label);
      case "entity":
        return found(lookups.entities.find((e) => e.value === key)?.label);
      case "lookup":
        return found(lookupNames.get(key));
      case "picklist":
      case "multipicklist":
      case "tags": {
        const source = field.picklist;
        if (source?.kind === "static") {
          const option = source.options.find((o) => o.value === key);
          return ok(option ? t(`${config.namespace}.${option.labelKey}`) : key);
        }
        if (source?.kind === "picklist") return ok(lookups.picklists[source.picklist]?.find((o) => o.value === key)?.label ?? key);
        if (source?.kind === "stages") return found(lookups.stages.find((s) => s.value === key)?.label);
        return ok(key);
      }
      default:
        return ok(key);
    }
  };
  const label = (field: FieldConfig, key: string, bucket?: ReportBucket): string => resolve(field, key, bucket).text;
  /** True when the viewer cannot read what `key` points to. */
  label.isRestricted = (field: FieldConfig, key: string): boolean => resolve(field, key).restricted;
  return label;
}
