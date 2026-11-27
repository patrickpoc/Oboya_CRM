import { NextResponse } from "next/server";
import type { MarkReadResponse } from "@/lib/crm/automation/api-contract";
import { markReadSchema } from "@/lib/crm/notifications/schemas";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { dbErrorResponse, parseBody } from "@/lib/crm/setup/api.server";

export const dynamic = "force-dynamic";

/** POST /api/crm/notifications/read — `{ ids }` (<= 100) or `{ all: true }`; own rows only. */
export async function POST(request: Request) {
  const guard = await crmGuard();
  if (guard instanceof NextResponse) return guard;
  const body = await parseBody(request, markReadSchema);
  if (body instanceof NextResponse) return body;

  let update = guard.supabase
    .from("crm_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", guard.user.id)
    .is("read_at", null);
  if ("ids" in body.data) update = update.in("id", body.data.ids);
  const { data, error } = await update.select("id");
  if (error) return dbErrorResponse(error, "Notifications mark read");

  const count = await guard.supabase
    .from("crm_notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", guard.user.id)
    .is("read_at", null);
  if (count.error) return dbErrorResponse(count.error, "Notifications count");
  const res: MarkReadResponse = { updated: data?.length ?? 0, unreadCount: count.count ?? 0 };
  return NextResponse.json(res, { headers: { "cache-control": "no-store" } });
}
