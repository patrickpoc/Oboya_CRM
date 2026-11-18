/**
 * Resolution SLA for support cases. A case is on the clock from creation
 * until it is resolved; the target depends on priority and defaults to
 * low 72h / normal 48h / high 24h / urgent 8h, overridable through
 * crm_settings.case_sla_hours.
 *
 * `warning` means 75% of the window has elapsed; `overdue` means the due
 * time has passed while the case is still open. `met` / `missed` are the
 * terminal states once resolved, compared against sla_due_at.
 */
export const DEFAULT_CASE_SLA_HOURS: Record<string, number> = {
  low: 72,
  normal: 48,
  high: 24,
  urgent: 8,
};

export const CASE_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type CasePriority = (typeof CASE_PRIORITIES)[number];

export type CaseSlaState = "on_track" | "warning" | "overdue" | "met" | "missed";
export const CASE_SLA_STATES: readonly CaseSlaState[] = [
  "on_track",
  "warning",
  "overdue",
  "met",
  "missed",
];

export type SlaCase = {
  status?: unknown;
  priority?: unknown;
  created_at?: unknown;
  sla_due_at?: unknown;
  resolved_at?: unknown;
};

/** Reads crm_settings.case_sla_hours, ignoring invalid entries per priority. */
export function parseCaseSlaHours(value: unknown): Record<string, number> {
  const out: Record<string, number> = { ...DEFAULT_CASE_SLA_HOURS };
  if (!value || typeof value !== "object") return out;
  const source = value as Record<string, unknown>;
  for (const priority of CASE_PRIORITIES) {
    const hours = Number(source[priority]);
    if (Number.isFinite(hours) && hours > 0) out[priority] = hours;
  }
  return out;
}

/** Hours left before the SLA due time (negative once overdue); null when not applicable. */
export function caseSlaHoursLeft(row: SlaCase, now: number, hours: Record<string, number>): number | null {
  const target = typeof row.sla_due_at === "string"
    ? new Date(row.sla_due_at).getTime()
    : typeof row.created_at === "string" && typeof row.priority === "string"
      ? new Date(row.created_at).getTime() + (hours[row.priority] ?? hours.normal ?? 48) * 36e5
      : NaN;
  if (!Number.isFinite(target)) return null;
  return (target - now) / 36e5;
}

/** SLA state from row columns; null when the case is closed without a resolution clock. */
export function caseSlaState(
  row: SlaCase,
  now: number = Date.now(),
  hours: Record<string, number> = DEFAULT_CASE_SLA_HOURS
): CaseSlaState | null {
  const left = caseSlaHoursLeft(row, now, hours);
  if (left === null) return null;

  if (row.status === "resolved" || row.status === "closed") {
    // Terminal state compares the actual resolution time with the target.
    const done = typeof row.resolved_at === "string" ? new Date(row.resolved_at).getTime() : NaN;
    const target = typeof row.sla_due_at === "string" ? new Date(row.sla_due_at).getTime() : NaN;
    if (!Number.isFinite(done) || !Number.isFinite(target)) return null;
    return done <= target ? "met" : "missed";
  }
  if (row.status !== "new" && row.status !== "working") return null;
  if (left <= 0) return "overdue";
  const target = typeof row.sla_due_at === "string"
    ? new Date(row.sla_due_at).getTime()
    : NaN;
  const created = typeof row.created_at === "string" ? new Date(row.created_at).getTime() : NaN;
  const window = Number.isFinite(target) && Number.isFinite(created) ? target - created : 0;
  if (window > 0 && (now - created) / window >= 0.75) return "warning";
  return "on_track";
}

/** SLA state per row id from columns already loaded (status, priority, created_at, sla_due_at). */
export function caseSlaFromRows<T extends SlaCase & { id: string }>(
  rows: ReadonlyArray<T>,
  now: number,
  hours: Record<string, number>
): Map<string, CaseSlaState | null> {
  const out = new Map<string, CaseSlaState | null>();
  for (const row of rows) out.set(row.id, caseSlaState(row, now, hours));
  return out;
}

/** Whole minutes spent from creation to resolution, or null while open. */
export function caseResolutionMinutes(row: SlaCase, now: number = Date.now()): number | null {
  const created = typeof row.created_at === "string" ? new Date(row.created_at).getTime() : NaN;
  if (!Number.isFinite(created)) return null;
  let endRaw = typeof row.resolved_at === "string" ? row.resolved_at : null;
  if (!endRaw) {
    if (row.status !== "resolved" && row.status !== "closed") return null;
    endRaw = new Date(now).toISOString();
  }
  const end = new Date(endRaw).getTime();
  if (!Number.isFinite(end)) return null;
  return Math.max(0, Math.floor((end - created) / 60_000));
}
