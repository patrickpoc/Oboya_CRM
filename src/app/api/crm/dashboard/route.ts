import { NextResponse } from "next/server";
import { z } from "zod";
import { loadDashboard } from "@/lib/crm/dashboard/queries";
import { safeTimeZone } from "@/lib/crm/dashboard/time";
import { invalid } from "@/lib/crm/objects/route-helpers";
import { canAccessUser } from "@/lib/crm/permissions/access-resolve";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";

const querySchema = z.object({
  entity_id: z.guid().optional(),
  tz: z.string().max(64).optional(),
});

/**
 * GET /api/crm/dashboard?entity_id=&tz= — home KPIs, pipeline by stage, my
 * tasks and recent records. RLS scopes every number to what the user can see;
 * `tz` (browser IANA zone) sets "today" and "this month".
 */
export async function GET(request: Request) {
  const guard = await crmGuard("home", "view");
  if (guard instanceof NextResponse) return guard;
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = querySchema.safeParse({ entity_id: params.entity_id || undefined, tz: params.tz || undefined });
  if (!parsed.success) return invalid();
  try {
    const data = await loadDashboard(guard.supabase, {
      userId: guard.user.id,
      entityId: parsed.data.entity_id ?? null,
      timeZone: safeTimeZone(parsed.data.tz),
      now: new Date(),
      can: (module, action = "view") => canAccessUser(guard.user, module, action, guard.matrix),
    });
    return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[crm dashboard]", error);
    return NextResponse.json({ error: "Request failed", code: "unavailable" }, { status: 500 });
  }
}
