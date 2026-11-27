import { NextResponse } from "next/server";
import type { NotificationsResponse } from "@/lib/crm/automation/api-contract";
import { fromDbRow } from "@/lib/crm/automation/types";
import { notificationsQuerySchema, type Notification } from "@/lib/crm/notifications/schemas";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { dbErrorResponse, isUuid, jsonError } from "@/lib/crm/setup/api.server";

export const dynamic = "force-dynamic";

const COLUMNS = "id,user_id,kind,params,object,record_id,read_at,created_at";
const ISO_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/;

const encodeCursor = (createdAt: string, id: string) => Buffer.from(`${createdAt}|${id}`).toString("base64url");
function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  const [createdAt, id, ...rest] = Buffer.from(cursor, "base64url").toString().split("|");
  return rest.length === 0 && createdAt && id && ISO_RE.test(createdAt) && isUuid(id) ? { createdAt, id } : null;
}

/** GET /api/crm/notifications?cursor=&limit=&unread= — the caller's own notifications, newest first. */
export async function GET(request: Request) {
  const guard = await crmGuard();
  if (guard instanceof NextResponse) return guard;
  const sp = new URL(request.url).searchParams;
  const q = notificationsQuerySchema.safeParse({
    cursor: sp.get("cursor") || undefined,
    limit: sp.get("limit") || undefined,
    unread: sp.get("unread") || undefined,
  });
  if (!q.success) return jsonError(400, "invalid_input", "Invalid filters");
  const { cursor, limit, unread } = q.data;
  const position = cursor ? decodeCursor(cursor) : null;
  if (cursor && !position) return jsonError(400, "invalid_input", "Invalid cursor");

  let query = guard.supabase
    .from("crm_notifications")
    .select(COLUMNS)
    .eq("user_id", guard.user.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (unread === "true") query = query.is("read_at", null);
  if (unread === "false") query = query.not("read_at", "is", null);
  if (position) {
    query = query.or(
      `created_at.lt."${position.createdAt}",and(created_at.eq."${position.createdAt}",id.lt.${position.id})`
    );
  }

  const [page, count] = await Promise.all([
    query,
    guard.supabase
      .from("crm_notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", guard.user.id)
      .is("read_at", null),
  ]);
  if (page.error) return dbErrorResponse(page.error, "Notifications read");
  if (count.error) return dbErrorResponse(count.error, "Notifications count");

  const rows = page.data ?? [];
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  const body: NotificationsResponse = {
    notifications: items.map((r) => fromDbRow<Notification>(r as unknown as Record<string, unknown>)),
    nextCursor: rows.length > limit && last ? encodeCursor(last.created_at, last.id) : null,
    unreadCount: count.count ?? 0,
  };
  return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
}
