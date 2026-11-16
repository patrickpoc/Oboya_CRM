/**
 * First-response SLA for leads, ported from the website admin
 * (lib/cms/forms/crm.ts `leadSlaState`). A lead is on the clock while it is
 * `new` and nobody has responded yet. Thresholds default to 24h / 48h and can
 * be overridden by crm_settings.lead_sla_hours.
 */
export const LEAD_SLA_WARNING_HOURS = 24;
export const LEAD_SLA_OVERDUE_HOURS = 48;

export type SlaHours = { warning: number; overdue: number };
export const DEFAULT_SLA_HOURS: SlaHours = {
  warning: LEAD_SLA_WARNING_HOURS,
  overdue: LEAD_SLA_OVERDUE_HOURS,
};

/** "on_track" is still within the window; null means the SLA no longer applies. */
export type LeadSlaState = "on_track" | "warning" | "overdue";
export const LEAD_SLA_STATES: readonly LeadSlaState[] = ["on_track", "warning", "overdue"];

export type SlaLead = {
  status?: unknown;
  created_at?: unknown;
  first_responded_at?: unknown;
};

/** Reads crm_settings.lead_sla_hours, falling back to 24/48 on anything invalid. */
export function parseSlaHours(value: unknown): SlaHours {
  if (!value || typeof value !== "object") return DEFAULT_SLA_HOURS;
  const v = value as Record<string, unknown>;
  const warning = Number(v.warning);
  const overdue = Number(v.overdue);
  if (!Number.isFinite(warning) || !Number.isFinite(overdue) || warning <= 0 || overdue < warning) {
    return DEFAULT_SLA_HOURS;
  }
  return { warning, overdue };
}

export function slaApplies(lead: SlaLead): boolean {
  return lead.status === "new" && !lead.first_responded_at;
}

export function leadSlaState(
  lead: SlaLead,
  now: number = Date.now(),
  hours: SlaHours = DEFAULT_SLA_HOURS
): LeadSlaState | null {
  if (!slaApplies(lead)) return null;
  const created = typeof lead.created_at === "string" ? new Date(lead.created_at).getTime() : NaN;
  if (!Number.isFinite(created)) return null;
  const ageHours = (now - created) / 36e5;
  if (ageHours >= hours.overdue) return "overdue";
  if (ageHours >= hours.warning) return "warning";
  return "on_track";
}

/** SLA state per row id from columns already loaded (status, created_at, first_responded_at). */
export function slaFromRows(
  rows: ReadonlyArray<SlaLead & { id: string }>,
  now: number,
  hours: SlaHours
): Map<string, LeadSlaState | null> {
  const out = new Map<string, LeadSlaState | null>();
  for (const row of rows) out.set(row.id, leadSlaState(row, now, hours));
  return out;
}
