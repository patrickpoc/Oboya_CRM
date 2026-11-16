import { addDays, dayKey } from "@/lib/crm/activities/due";

/**
 * Day and month boundaries in the viewer's timezone, as UTC instants, for
 * server-side counts ("due today", "won this month"). The browser sends its
 * IANA timezone (`tz`); anything invalid falls back to UTC. Pure: no server or
 * React imports.
 */

/** True when `tz` is an IANA timezone this runtime knows. */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function safeTimeZone(tz: unknown): string {
  return isValidTimeZone(tz) ? tz : "UTC";
}

/** Offset (ms) of `timeZone` from UTC at the instant `at`. */
function offsetMs(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** The UTC instant of 00:00 on calendar day `key` (YYYY-MM-DD) in `timeZone`. */
export function zonedMidnight(key: string, timeZone: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  // Two passes settle DST transitions (the offset at the guess may differ).
  let instant = guess - offsetMs(guess, timeZone);
  instant = guess - offsetMs(instant, timeZone);
  return new Date(instant);
}

/** [start of today, start of tomorrow) in `timeZone`. */
export function dayBounds(now: Date, timeZone: string): { start: Date; end: Date } {
  const today = dayKey(now, timeZone);
  return { start: zonedMidnight(today, timeZone), end: zonedMidnight(addDays(today, 1), timeZone) };
}

/** [first day of this month, first day of next month) in `timeZone`. */
export function monthBounds(now: Date, timeZone: string): { start: Date; end: Date } {
  const [y, m] = dayKey(now, timeZone).split("-").map(Number);
  const first = `${y}-${String(m).padStart(2, "0")}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { start: zonedMidnight(first, timeZone), end: zonedMidnight(next, timeZone) };
}
