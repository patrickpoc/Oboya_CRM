export const PICKLISTS = ["lead_source", "segment", "industry", "loss_reason", "tag"] as const;
export type PicklistName = (typeof PICKLISTS)[number];

export function isPicklistName(value: unknown): value is PicklistName {
  return typeof value === "string" && (PICKLISTS as readonly string[]).includes(value);
}

/** Same rule as the crm_picklist_values.value check constraint. */
export const PICKLIST_VALUE_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** Stable value from a label: lowercase ascii, words joined by "_" ("-" for tags). */
export function slugifyPicklistValue(label: string, picklist?: PicklistName): string {
  const sep = picklist === "tag" ? "-" : "_";
  return label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, sep)
    .replace(new RegExp(`^[${sep}]+|[${sep}]+$`, "g"), "")
    .slice(0, 40)
    .replace(new RegExp(`[${sep}]+$`), "");
}
