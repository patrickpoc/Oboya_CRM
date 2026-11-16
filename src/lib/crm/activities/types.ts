import type { RecordRow } from "@/lib/crm/objects/types";

/** An audit event shown on a record timeline (labels resolved server-side). */
export type TimelineAuditEvent = {
  kind: "audit";
  id: string;
  action: "create" | "stage_change" | "convert" | "owner_change";
  actor: string;
  created_at: string;
  /** Display labels, or raw values when `values` says how the UI translates them. */
  from: string | null;
  to: string | null;
  /** `lead_status`: from/to are lead status values (UI copy `leads.statuses.<value>`). */
  values?: "lead_status";
};

export type TimelineResponse = { activities: RecordRow[]; events: TimelineAuditEvent[] };
