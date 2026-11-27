import { NextResponse } from "next/server";
import { DashboardInputSchema } from "@/lib/crm/reports/definition";
import { createDashboard, listDashboards, publishActor } from "@/lib/crm/reports/repository";
import { failure, forbidden, reportsGuard, viewerOf } from "@/lib/crm/reports/route";
import { canPublish } from "@/lib/crm/reports/sharing";
import { parseBody } from "@/lib/crm/setup/api.server";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await reportsGuard("view");
  if (guard instanceof NextResponse) return guard;
  try {
    return NextResponse.json({ dashboards: await listDashboards(guard.supabase, viewerOf(guard)) });
  } catch (error) {
    return failure(error, "List dashboards");
  }
}

export async function POST(request: Request) {
  const guard = await reportsGuard("create");
  if (guard instanceof NextResponse) return guard;
  const body = await parseBody(request, DashboardInputSchema);
  if (body instanceof NextResponse) return body;
  try {
    const actor = await publishActor(guard.supabase, viewerOf(guard));
    if (!canPublish(actor, body.data.visibility, body.data.teamId)) return forbidden();
    const dashboard = await createDashboard(guard.supabase, viewerOf(guard), body.data);
    return NextResponse.json({ dashboard }, { status: 201 });
  } catch (error) {
    return failure(error, "Create dashboard");
  }
}
