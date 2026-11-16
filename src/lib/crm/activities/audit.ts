import type { CrmObject } from "@/lib/crm/objects/types";
import type { TimelineAuditEvent } from "./types";

export type AuditRow = { id: number; action: string; actor_name: string; diff: Record<string, unknown>; created_at: string };

/** `[old, new]` of a diff key, or null. */
export function pair(diff: Record<string, unknown> | null | undefined, key: string): [unknown, unknown] | null {
  const value = diff?.[key];
  return Array.isArray(value) && value.length === 2 ? (value as [unknown, unknown]) : null;
}

/** The diff key a stage_change audit row changes: lead `status`, otherwise `stage_id`. */
export function stageDiffKey(object: CrmObject): "status" | "stage_id" {
  return object === "lead" ? "status" : "stage_id";
}

const str = (v: unknown) => (typeof v === "string" ? v : null);

/**
 * Audit row -> timeline event. Stage changes read `stage_id` (labels from
 * `stageName`) or, on leads, `status` (raw values, translated by the UI);
 * owner changes read `owner_id` (labels from `userName`).
 */
export function toTimelineEvent(
  object: CrmObject,
  row: AuditRow,
  userName: Map<string, string>,
  stageName: Map<string, string>
): TimelineAuditEvent {
  const base = {
    kind: "audit" as const,
    id: `audit-${row.id}`,
    action: row.action as TimelineAuditEvent["action"],
    actor: row.actor_name,
    created_at: row.created_at,
  };
  const label = (map: Map<string, string>, v: unknown) => (typeof v === "string" ? (map.get(v) ?? null) : null);
  if (row.action === "stage_change") {
    const change = pair(row.diff, stageDiffKey(object));
    if (object === "lead") return { ...base, from: str(change?.[0]), to: str(change?.[1]), values: "lead_status" };
    return { ...base, from: change ? label(stageName, change[0]) : null, to: change ? label(stageName, change[1]) : null };
  }
  if (row.action === "owner_change") {
    const change = pair(row.diff, "owner_id");
    return { ...base, from: change ? label(userName, change[0]) : null, to: change ? label(userName, change[1]) : null };
  }
  return { ...base, from: null, to: null };
}
