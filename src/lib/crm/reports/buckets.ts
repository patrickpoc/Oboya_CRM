import { addDays, dayKey } from "@/lib/crm/activities/due";
import type { ReportBucket } from "./definition";

/**
 * Calendar buckets in the viewer's timezone. Keys sort lexicographically:
 * day `YYYY-MM-DD`, week `YYYY-Www` (ISO 8601, Monday first), month
 * `YYYY-MM`, quarter `YYYY-Qn`, year `YYYY`. Pure: no server imports.
 */

const DAY_RE = /^\d{4}-\d{2}-\d{2}/;
const pad = (n: number) => String(n).padStart(2, "0");

function utcOf(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Calendar day of a `date` column ("YYYY-MM-DD") or a `datetime` instant in `timeZone`; null when invalid. */
export function localDay(value: unknown, timeZone: string): string | null {
  if (typeof value !== "string" || !value) return null;
  // A plain date has no zone: it is already the calendar day.
  if (value.length === 10 && DAY_RE.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : dayKey(date, timeZone);
}

/** ISO year and week of a calendar day. */
export function isoWeek(day: string): { year: number; week: number } {
  const date = utcOf(day);
  const dow = date.getUTCDay() || 7;
  // The Thursday of this week decides the ISO year.
  const thursday = new Date(date.getTime() + (4 - dow) * 864e5);
  const year = thursday.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  return { year, week: Math.ceil(((thursday.getTime() - yearStart) / 864e5 + 1) / 7) };
}

/** Sortable bucket key of a date/datetime value; null when empty or invalid. */
export function bucketKey(value: unknown, bucket: ReportBucket, timeZone: string): string | null {
  const day = localDay(value, timeZone);
  if (!day) return null;
  const [y, m] = day.split("-").map(Number);
  switch (bucket) {
    case "day":
      return day;
    case "week": {
      const w = isoWeek(day);
      return `${w.year}-W${pad(w.week)}`;
    }
    case "month":
      return `${y}-${pad(m)}`;
    case "quarter":
      return `${y}-Q${Math.ceil(m / 3)}`;
    case "year":
      return String(y);
  }
}

/** Monday of ISO week `week` of `year`, as YYYY-MM-DD. */
function isoWeekMonday(year: number, week: number): string {
  const jan4 = `${year}-01-04`;
  const dow = utcOf(jan4).getUTCDay() || 7;
  return addDays(jan4, 1 - dow + (week - 1) * 7);
}

/** Label of a bucket key in the user's locale. */
export function bucketLabel(key: string, bucket: ReportBucket, locale: string): string {
  const fmt = (options: Intl.DateTimeFormatOptions, day: string) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(utcOf(day));
  try {
    switch (bucket) {
      case "day":
        return fmt({ dateStyle: "medium" }, key);
      case "week": {
        const [year, week] = key.split("-W").map(Number);
        return `${key} (${fmt({ dateStyle: "medium" }, isoWeekMonday(year, week))})`;
      }
      case "month":
        return fmt({ month: "long", year: "numeric" }, `${key}-01`);
      case "quarter":
        return key.replace(/^(\d{4})-(Q\d)$/, "$2 $1");
      case "year":
        return key;
    }
  } catch {
    return key;
  }
}
