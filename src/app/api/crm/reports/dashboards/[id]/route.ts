import { NextResponse } from "next/server";
import {
  deleteDashboard,
  getDashboard,
  publishActor,
  updateDashboard,
} from "@/lib/crm/reports/repository";
import {
  DashboardPatchSchema,
  IdSchema,
  failure,
  forbidden,
  notFound,
  reportsGuard,
  viewerOf,
} from "@/lib/crm/reports/route";
import { canPublish } from "@/lib/crm/reports/sharing";
import { parseBody, type IdParams } from "@/lib/crm/setup/api.server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: IdParams) {
  const guard = await reportsGuard("view");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) return notFound();
  try {
    const dashboard = await getDashboard(guard.supabase, viewerOf(guard), id);
    return dashboard ? NextResponse.json({ dashboard }) : notFound();
  } catch (error) {
    return failure(error, "Get dashboard");
  }
}

export async function PATCH(request: Request, { params }: IdParams) {
  const guard = await reportsGuard("edit");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) return notFound();
  const body = await parseBody(request, DashboardPatchSchema);
  if (body instanceof NextResponse) return body;
  try {
    if (body.data.visibility) {
      const actor = await publishActor(guard.supabase, viewerOf(guard));
      if (!canPublish(actor, body.data.visibility, body.data.teamId)) return forbidden();
    }
    const dashboard = await updateDashboard(guard.supabase, viewerOf(guard), id, body.data);
    return dashboard ? NextResponse.json({ dashboard }) : notFound();
  } catch (error) {
    return failure(error, "Update dashboard");
  }
}

export async function DELETE(_request: Request, { params }: IdParams) {
  const guard = await reportsGuard("delete");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) return notFound();
  try {
    return (await deleteDashboard(guard.supabase, id)) ? NextResponse.json({ ok: true }) : notFound();
  } catch (error) {
    return failure(error, "Delete dashboard");
  }
}
