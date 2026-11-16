"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { CalendarClock, CheckSquare, Mail, Phone, StickyNote, type LucideIcon } from "lucide-react";
import { useFormatter } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import { apiFetch } from "@/components/crm/record/api";
import { browserTimeZone } from "@/lib/crm/activities/due";
import { isCrmObject, OBJECT_META, type RecordRow } from "@/lib/crm/objects/types";
import { cn } from "@/lib/utils";

export const TYPE_ICONS: Record<string, LucideIcon> = {
  task: CheckSquare,
  call: Phone,
  meeting: CalendarClock,
  note: StickyNote,
  email: Mail,
};

export function ActivityTypeIcon({ type, className }: { type: unknown; className?: string }) {
  const Icon = TYPE_ICONS[typeof type === "string" ? type : "note"] ?? StickyNote;
  return (
    <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full bg-oboya-soft-white text-oboya-blue", className)}>
      <Icon className="size-3.5" />
    </span>
  );
}

const MINUTE = 60_000;
const subscribeMinute = (onChange: () => void) => {
  const timer = setInterval(onChange, MINUTE);
  return () => clearInterval(timer);
};
const minuteNow = () => Math.floor(Date.now() / MINUTE) * MINUTE;
const noop = () => () => {};

/**
 * The viewer's clock and IANA timezone (from the browser). Null during SSR and
 * hydration, so "today" is never computed with the server's timezone.
 */
export function useViewerClock(): { now: Date; timeZone: string } | null {
  const now = useSyncExternalStore(subscribeMinute, minuteNow, () => null);
  const timeZone = useSyncExternalStore(noop, browserTimeZone, () => null);
  return now === null || timeZone === null ? null : { now: new Date(now), timeZone };
}

/** Link to the related record (what_object/what_id) with its display name. */
export function RelatedLink({ row, className }: { row: RecordRow; className?: string }) {
  const object = row.what_object;
  const name = row._display?.what_id;
  if (!isCrmObject(object) || typeof row.what_id !== "string" || !name) return null;
  return (
    <Link href={`${OBJECT_META[object].basePath}/${row.what_id}`} className={cn("truncate text-oboya-blue-light hover:underline", className)}>
      {name}
    </Link>
  );
}

/** Due date, in brand orange when overdue. */
export function DueDate({ value, overdue }: { value: unknown; overdue: boolean }) {
  const format = useFormatter();
  if (typeof value !== "string") return null;
  return (
    <time dateTime={value} className={cn("tabular-nums", overdue ? "font-medium text-oboya-orange" : "text-muted-foreground")}>
      {format.dateTime(new Date(value), { dateStyle: "medium", timeStyle: "short" })}
    </time>
  );
}

export function CompleteCheckbox({
  done,
  disabled,
  label,
  onToggle,
}: {
  done: boolean;
  disabled?: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <Checkbox
      checked={done}
      disabled={disabled}
      aria-label={label}
      onCheckedChange={() => onToggle()}
      className="mt-1 data-checked:border-oboya-green data-checked:bg-oboya-green"
    />
  );
}

export type NewActivity = {
  type: "task" | "call" | "meeting" | "note";
  subject: string;
  body?: string | null;
  due_at?: string | null;
  status: "open" | "done";
  priority?: string;
  what_object?: string;
  what_id?: string;
  who_contact_id?: string;
};

export function createActivity(values: NewActivity) {
  return apiFetch<{ record: RecordRow }>("/api/crm/activities", { method: "POST", body: JSON.stringify(values) });
}

/** datetime-local value (viewer's local time) to ISO, or null. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
