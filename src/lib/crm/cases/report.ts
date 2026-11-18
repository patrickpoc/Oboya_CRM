/**
 * Case list reporting: resolution time and SLA breaches from the loaded
 * rows. Pure and client-safe so the list page can show a compact summary
 * without a second query or a server round trip.
 */
import { caseSlaState, type CaseSlaState, type SlaCase } from "./sla";

export type CaseReportRow = SlaCase & { id: string };

export type CaseReport = {
  total: number;
  open: number;
  resolved: number;
  breached: number;
  avgResolutionMinutes: number | null;
  byState: Record<CaseSlaState, number>;
};

export function caseReport(
  rows: ReadonlyArray<CaseReportRow>,
  now: number = Date.now(),
  hours: Record<string, number> = {}
): CaseReport {
  const byState: Record<CaseSlaState, number> = {
    on_track: 0,
    warning: 0,
    overdue: 0,
    met: 0,
    missed: 0,
  };
  let open = 0;
  let resolved = 0;
  let breached = 0;
  let minutes = 0;
  let timed = 0;

  for (const row of rows) {
    const isResolved = row.status === "resolved" || row.status === "closed";
    if (isResolved) resolved += 1;
    else open += 1;

    const state = caseSlaState(row, now, hours);
    if (state) byState[state] += 1;
    if (state === "overdue" || state === "missed") breached += 1;

    const created = typeof row.created_at === "string" ? new Date(row.created_at).getTime() : NaN;
    let end: number = NaN;
    if (typeof (row as { resolved_at?: unknown }).resolved_at === "string") {
      end = new Date((row as { resolved_at: string }).resolved_at).getTime();
    } else if (isResolved) {
      end = now;
    }
    if (Number.isFinite(created) && Number.isFinite(end) && end >= created) {
      minutes += Math.floor((end - created) / 60_000);
      timed += 1;
    }
  }

  return {
    total: rows.length,
    open,
    resolved,
    breached,
    avgResolutionMinutes: timed ? Math.round(minutes / timed) : null,
    byState,
  };
}

export function formatResolution(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}
