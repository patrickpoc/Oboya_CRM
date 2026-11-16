/**
 * Pure date logic for activities (My tasks sections, timeline grouping, list
 * due-range filter). No server or React imports: used on both sides.
 *
 * Timezone choice: "today" is a calendar day in the *viewer's* timezone, read
 * in the browser with Intl (`browserTimeZone()`), because a rep in São Paulo
 * and one in Shanghai must both see a task due "today" in their own day. The
 * server never decides "today" (it does not know the browser timezone); the
 * list due-range filter therefore uses rolling instants (now, now + 7 days),
 * which do not depend on a timezone.
 */

export const DUE_BUCKETS = ["overdue", "today", "next7", "later", "none"] as const;
export type DueBucket = (typeof DUE_BUCKETS)[number];

export const DUE_RANGES = ["overdue", "next7", "later", "none"] as const;
export type DueRange = (typeof DUE_RANGES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

/** The browser's IANA timezone (UTC when unavailable). */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Calendar day (YYYY-MM-DD) of an instant in a timezone. */
export function dayKey(date: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Adds whole days to a YYYY-MM-DD key (calendar arithmetic, DST-safe). */
export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function parse(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Section of an open task. Days are compared in `timeZone`:
 * before today = overdue; today; tomorrow..today+7 = next7; after = later.
 */
export function dueBucket(dueAt: string | null | undefined, now: Date, timeZone: string): DueBucket {
  const due = parse(dueAt);
  if (!due) return "none";
  const today = dayKey(now, timeZone);
  const day = dayKey(due, timeZone);
  if (day < today) return "overdue";
  if (day === today) return "today";
  if (day <= addDays(today, 7)) return "next7";
  return "later";
}

/** True when an open activity's due day is before today (timeline highlighting). */
export function isOverdue(
  activity: { status?: unknown; due_at?: unknown; [key: string]: unknown },
  now: Date,
  timeZone: string
): boolean {
  return (
    activity.status === "open" &&
    typeof activity.due_at === "string" &&
    dueBucket(activity.due_at, now, timeZone) === "overdue"
  );
}

type Dated = { id: string; due_at?: unknown; created_at?: unknown; completed_at?: unknown };

const str = (v: unknown) => (typeof v === "string" ? v : null);

/** Groups open tasks into sections, each sorted by due date (no date: newest first). */
export function groupByDue<T extends Dated>(
  tasks: T[],
  now: Date,
  timeZone: string
): Record<DueBucket, T[]> {
  const out = Object.fromEntries(DUE_BUCKETS.map((b) => [b, [] as T[]])) as Record<DueBucket, T[]>;
  for (const task of tasks) out[dueBucket(str(task.due_at), now, timeZone)].push(task);
  const byDue = (a: T, b: T) => (str(a.due_at) ?? "").localeCompare(str(b.due_at) ?? "");
  for (const bucket of DUE_BUCKETS) {
    if (bucket === "none") out[bucket].sort((a, b) => (str(b.created_at) ?? "").localeCompare(str(a.created_at) ?? ""));
    else out[bucket].sort(byDue);
  }
  return out;
}

/** Completed within the last `days` days (rolling window). */
export function completedSince<T extends Dated>(tasks: T[], now: Date, days = 14): T[] {
  const cutoff = now.getTime() - days * DAY_MS;
  return tasks
    .filter((t) => {
      const done = parse(str(t.completed_at));
      return done !== null && done.getTime() >= cutoff;
    })
    .sort((a, b) => (str(b.completed_at) ?? "").localeCompare(str(a.completed_at) ?? ""));
}

/** When an activity "happened", for newest-first ordering. */
export function activityTime(a: Dated): string {
  return str(a.completed_at) ?? str(a.due_at) ?? str(a.created_at) ?? "";
}

/** Open tasks and meetings are "upcoming & overdue"; everything else is past. */
export function isUpcoming(a: { type?: unknown; status?: unknown }): boolean {
  return a.status === "open" && (a.type === "task" || a.type === "meeting");
}

export type TimelineEvent = { kind: "audit"; id: string; created_at: string };

/**
 * Timeline groups: upcoming (open tasks/meetings, soonest due first, no date
 * last) and past (other activities merged with audit events, newest first).
 */
export function splitTimeline<A extends Dated & { type?: unknown; status?: unknown }, E extends TimelineEvent>(
  activities: A[],
  events: E[]
): { upcoming: A[]; past: Array<{ kind: "activity"; item: A } | { kind: "audit"; item: E }> } {
  const upcoming = activities
    .filter(isUpcoming)
    .sort((a, b) => {
      const da = str(a.due_at);
      const db = str(b.due_at);
      if (da && db) return da.localeCompare(db);
      if (da) return -1;
      if (db) return 1;
      return (str(b.created_at) ?? "").localeCompare(str(a.created_at) ?? "");
    });
  const past = [
    ...activities.filter((a) => !isUpcoming(a)).map((item) => ({ kind: "activity" as const, item, at: activityTime(item) })),
    ...events.map((item) => ({ kind: "audit" as const, item, at: item.created_at })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .map(({ kind, item }) => ({ kind, item }) as { kind: "activity"; item: A } | { kind: "audit"; item: E });
  return { upcoming, past };
}

/**
 * Bounds of a list due-range filter, as rolling instants from `now`.
 * overdue = open and due before now; next7 = due in [now, now + 7d);
 * later = due from now + 7d; none = no due date.
 */
export function dueRangeBounds(
  range: string,
  now: Date
): { status?: "open"; from?: string; to?: string; none?: true } | null {
  const nowIso = now.toISOString();
  const in7 = new Date(now.getTime() + 7 * DAY_MS).toISOString();
  switch (range) {
    case "overdue":
      return { status: "open", to: nowIso };
    case "next7":
      return { from: nowIso, to: in7 };
    case "later":
      return { from: in7 };
    case "none":
      return { none: true };
    default:
      return null;
  }
}
