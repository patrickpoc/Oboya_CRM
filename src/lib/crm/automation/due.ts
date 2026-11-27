/** Pure date helpers for stage-task templates and alert thresholds. */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Due date of a stage task: now + dueInDays (0-365 days). */
export function dueDateFromDays(dueInDays: number, now: Date): Date {
  const days = Math.min(365, Math.max(0, Math.trunc(dueInDays) || 0));
  return new Date(now.getTime() + days * DAY_MS);
}

/** Last touch = latest of the stage entry and the last activity. */
export function lastTouch(stageEnteredAt: Date, lastActivityAt?: Date | null): Date {
  return lastActivityAt && lastActivityAt > stageEnteredAt ? lastActivityAt : stageEnteredAt;
}

/** Whole days since `lastTouchAt`. */
export function stalledAgeDays(lastTouchAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - lastTouchAt.getTime()) / DAY_MS));
}

export function isStalled(lastTouchAt: Date, now: Date, thresholdDays: number): boolean {
  return now.getTime() - lastTouchAt.getTime() >= thresholdDays * DAY_MS;
}

/** A task is overdue once `due_at < now - grace` (strict). */
export function isTaskOverdue(dueAt: Date | null, now: Date, graceHours: number): boolean {
  if (!dueAt) return false;
  return dueAt.getTime() < now.getTime() - Math.max(0, graceHours) * HOUR_MS;
}
