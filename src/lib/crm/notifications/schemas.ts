import { z } from "zod";
import type { CrmObject } from "@/lib/crm/objects/types";
import type { NotificationKind } from "./kinds";

export type Notification = {
  id: string;
  userId: string;
  kind: NotificationKind;
  /** ICU params for the kind's title/body (<= 4 KB). */
  params: Record<string, string | number | null>;
  object: CrmObject | null;
  recordId: string | null;
  readAt: string | null;
  createdAt: string;
};

export const NOTIFICATIONS_MAX_LIMIT = 50;

export const notificationsQuerySchema = z.object({
  /** Opaque cursor: the previous page's `nextCursor`. */
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(NOTIFICATIONS_MAX_LIMIT).default(20),
  unread: z.enum(["true", "false"]).optional(),
});
export type NotificationsQuery = z.infer<typeof notificationsQuerySchema>;

export const markReadSchema = z.union([
  z.object({ ids: z.array(z.string().uuid()).min(1).max(100) }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);
export type MarkReadInput = z.infer<typeof markReadSchema>;
