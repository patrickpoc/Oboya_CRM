import { NextResponse } from "next/server";
import { deleteReport, getReport, updateReport } from "@/lib/crm/reports/repository";
import {
  IdSchema,
  ReportPatchSchema,
  canOnObject,
  definitionProblem,
  failure,
  forbidden,
  notFound,
  reportsGuard,
  viewerOf,
} from "@/lib/crm/reports/route";
import { parseBody, type IdParams } from "@/lib/crm/setup/api.server";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: IdParams) {
  const guard = await reportsGuard("view");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) return notFound();
  try {
    const report = await getReport(guard.supabase, viewerOf(guard), id);
    return report ? NextResponse.json({ report }) : notFound();
  } catch (error) {
    return failure(error, "Get report");
  }
}

export async function PATCH(request: Request, { params }: IdParams) {
  const guard = await reportsGuard("edit");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) return notFound();
  const body = await parseBody(request, ReportPatchSchema);
  if (body instanceof NextResponse) return body;
  if (body.data.definition) {
    if (!canOnObject(guard, body.data.definition.object, "view")) return forbidden();
    const problem = definitionProblem(body.data.definition);
    if (problem) return problem;
  }
  try {
    const report = await updateReport(guard.supabase, viewerOf(guard), id, body.data);
    return report ? NextResponse.json({ report }) : notFound();
  } catch (error) {
    return failure(error, "Update report");
  }
}

export async function DELETE(_request: Request, { params }: IdParams) {
  const guard = await reportsGuard("delete");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) return notFound();
  try {
    return (await deleteReport(guard.supabase, id)) ? NextResponse.json({ ok: true }) : notFound();
  } catch (error) {
    return failure(error, "Delete report");
  }
}
