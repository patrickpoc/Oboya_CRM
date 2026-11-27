import { NextResponse } from "next/server";
import { z } from "zod";
import { dayBounds, safeTimeZone } from "@/lib/crm/dashboard/time";
import { invalid } from "@/lib/crm/objects/route-helpers";
import { canAccessUser } from "@/lib/crm/permissions/access-resolve";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";

const querySchema = z.object({ tz: z.string().max(64).optional() });

/**
 * GET /api/crm/nav-counts?tz= — sidebar badges for the current user:
 * `leadsNew` (new leads they own) and `tasksDue` (their open tasks due today
 * or overdue, "today" in the browser timezone) and `notificationsUnread` (their unread bell items).
 */
export async function GET(request: Request) {
  const guard = await crmGuard();
  if (guard instanceof NextResponse) return guard;
  const parsed = querySchema.safeParse({ tz: new URL(request.url).searchParams.get("tz") || undefined });
  if (!parsed.success) return invalid();
  const can = (module: "leads" | "activities") => canAccessUser(guard.user, module, "view", guard.matrix);
  const { end } = dayBounds(new Date(), safeTimeZone(parsed.data.tz));
  const userId = guard.user.id;

  const [leads, tasks, notifications] = await Promise.all([
    can("leads")
      ? guard.supabase
          .from("crm_leads")
          .select("id", { count: "exact", head: true })
          .eq("owner_id", userId)
          .eq("status", "new")
          .is("deleted_at", null)
      : null,
    can("activities")
      ? guard.supabase
          .from("crm_activities")
          .select("id", { count: "exact", head: true })
          .eq("owner_id", userId)
          .eq("type", "task")
          .eq("status", "open")
          .lt("due_at", end.toISOString())
          .is("deleted_at", null)
      : null,
    guard.supabase
      .from("crm_notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("read_at", null),
  ]);
  if (leads?.error || tasks?.error || notifications.error) {
    console.error("[crm nav-counts]", leads?.error?.message ?? tasks?.error?.message ?? notifications.error?.message);
    return NextResponse.json({ error: "Request failed", code: "unavailable" }, { status: 500 });
  }
  return NextResponse.json(
    { leadsNew: leads?.count ?? 0, tasksDue: tasks?.count ?? 0, notificationsUnread: notifications.count ?? 0 },
    { headers: { "cache-control": "no-store" } }
  );
}
