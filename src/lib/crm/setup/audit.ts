/*
 * Audit log helpers (D4). crm_audit_logs.diff = { field: [old, new] } written by
 * crm_audit_trigger (supabase/migrations/20261116000500_crm_audit.sql, extended
 * to config tables in 20261116000700_crm_v1_fixes.sql). Config rows with a
 * non-uuid key (roles, settings, the access matrix) carry record_key instead
 * of record_id.
 */

/** Objects with a record page. */
export const AUDIT_RECORD_OBJECTS = ["lead", "account", "contact", "opportunity", "activity"] as const;
export type AuditRecordObject = (typeof AUDIT_RECORD_OBJECTS)[number];

/** Setup / configuration tables (no record page). */
export const AUDIT_CONFIG_OBJECTS = [
  "setup_stage",
  "picklist",
  "entity",
  "role",
  "team",
  "user",
  "access_control",
  "settings",
] as const;

export const AUDIT_OBJECTS = [...AUDIT_RECORD_OBJECTS, ...AUDIT_CONFIG_OBJECTS] as const;
export type AuditObject = (typeof AUDIT_OBJECTS)[number];

export const AUDIT_ACTIONS = [
  "create",
  "update",
  "delete",
  "restore",
  "stage_change",
  "owner_change",
  "convert",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

const OBJECT_PATHS: Record<AuditRecordObject, string> = {
  lead: "/leads",
  account: "/accounts",
  contact: "/contacts",
  opportunity: "/opportunities",
  activity: "/activities",
};

export function isAuditObject(value: unknown): value is AuditObject {
  return typeof value === "string" && (AUDIT_OBJECTS as readonly string[]).includes(value);
}

export function isAuditAction(value: unknown): value is AuditAction {
  return typeof value === "string" && (AUDIT_ACTIONS as readonly string[]).includes(value);
}

function isAuditRecordObject(value: string): value is AuditRecordObject {
  return (AUDIT_RECORD_OBJECTS as readonly string[]).includes(value);
}

/** Record page for an audited row; null for config objects, unknown objects or no id. */
export function auditRecordHref(object: string, recordId: string | null | undefined): string | null {
  if (!recordId || !isAuditRecordObject(object)) return null;
  return `${OBJECT_PATHS[object]}/${encodeURIComponent(recordId)}`;
}

/** Short reference shown under the object: uuid prefix, or the full non-uuid key. */
export function auditRecordLabel(recordId: string | null | undefined, recordKey: string | null | undefined): string {
  if (recordId) return recordId.slice(0, 8);
  return recordKey ?? "";
}

export type DiffEntry = { field: string; before: unknown; after: unknown };

/** { field: [old, new] } as sorted entries; malformed values are skipped. */
export function diffEntries(diff: unknown): DiffEntry[] {
  if (!diff || typeof diff !== "object" || Array.isArray(diff)) return [];
  return Object.entries(diff as Record<string, unknown>)
    .filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]) && entry[1].length === 2)
    .map(([field, [before, after]]) => ({ field, before, after }))
    .sort((a, b) => a.field.localeCompare(b.field));
}

/** Display text for one diff value. */
export function formatDiffValue(value: unknown, max = 200): string {
  if (value === null || value === undefined || value === "") return "—";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Actor name: the current crm_users name, else the snapshot, else "system". */
export function resolveActorName(
  actorId: string | null,
  snapshot: string | null | undefined,
  names: ReadonlyMap<string, string>
): string {
  const live = actorId ? names.get(actorId)?.trim() : undefined;
  return live || snapshot?.trim() || "system";
}

/** Inclusive date filters (yyyy-mm-dd) to ISO bounds; `to` covers the whole day (UTC). */
export function auditDateBounds(from?: string, to?: string): { gte?: string; lt?: string } {
  const valid = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) ? d : undefined);
  const f = valid(from);
  const t = valid(to);
  const out: { gte?: string; lt?: string } = {};
  if (f) out.gte = `${f}T00:00:00.000Z`;
  if (t) {
    const end = new Date(`${t}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    out.lt = end.toISOString();
  }
  return out;
}
