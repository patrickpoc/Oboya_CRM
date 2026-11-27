import { OBJECT_META, type CrmObject } from "@/lib/crm/objects/types";

export const NOTIFICATION_KINDS = [
  "sla_escalation",
  "stalled_deal",
  "overdue_task",
  "task_assigned",
  "lead_assigned",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type NotificationKindMeta = {
  /** Keys inside the `notifications` i18n namespace; ICU params come from `Notification.params`. */
  titleKey: string;
  bodyKey: string;
  /** lucide-react icon name. */
  icon: string;
  href: (object: CrmObject, recordId: string) => string;
};

const toRecord = (object: CrmObject, recordId: string) => `${OBJECT_META[object].basePath}/${recordId}`;

export const NOTIFICATION_KIND_META: Record<NotificationKind, NotificationKindMeta> = {
  sla_escalation: { titleKey: "kinds.sla_escalation.title", bodyKey: "kinds.sla_escalation.body", icon: "AlarmClock", href: toRecord },
  stalled_deal: { titleKey: "kinds.stalled_deal.title", bodyKey: "kinds.stalled_deal.body", icon: "Hourglass", href: toRecord },
  overdue_task: { titleKey: "kinds.overdue_task.title", bodyKey: "kinds.overdue_task.body", icon: "CalendarClock", href: toRecord },
  task_assigned: { titleKey: "kinds.task_assigned.title", bodyKey: "kinds.task_assigned.body", icon: "ListChecks", href: toRecord },
  lead_assigned: { titleKey: "kinds.lead_assigned.title", bodyKey: "kinds.lead_assigned.body", icon: "UserPlus", href: toRecord },
};

export function isNotificationKind(v: unknown): v is NotificationKind {
  return typeof v === "string" && (NOTIFICATION_KINDS as readonly string[]).includes(v);
}
