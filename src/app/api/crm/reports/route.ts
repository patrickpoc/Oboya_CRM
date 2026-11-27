import { NextResponse } from "next/server";
import { z } from "zod";
import { REPORT_OBJECTS, ReportInputSchema } from "@/lib/crm/reports/definition";
import { createReport, listReports } from "@/lib/crm/reports/repository";
import {
  canOnObject,
  definitionProblem,
  failure,
  forbidden,
  invalidInput,
  reportsGuard,
  viewerOf,
} from "@/lib/crm/reports/route";
import { parseBody } from "@/lib/crm/setup/api.server";

export const dynamic = "force-dynamic";

const ListQuerySchema = z.object({
  folderId: z.guid().optional(),
  q: z.string().max(100).optional(),
  object: z.enum(REPORT_OBJECTS).optional(),
});

export async function GET(request: Request) {
  const guard = await reportsGuard("view");
  if (guard instanceof NextResponse) return guard;
  const params = Object.fromEntries(new URL(request.url).searchParams);
  const query = ListQuerySchema.safeParse(params);
  if (!query.success) return invalidInput(query.error);
  try {
    return NextResponse.json({ reports: await listReports(guard.supabase, viewerOf(guard), query.data) });
  } catch (error) {
    return failure(error, "List reports");
  }
}

export async function POST(request: Request) {
  const guard = await reportsGuard("create");
  if (guard instanceof NextResponse) return guard;
  const body = await parseBody(request, ReportInputSchema);
  if (body instanceof NextResponse) return body;
  if (!canOnObject(guard, body.data.definition.object, "view")) return forbidden();
  const problem = definitionProblem(body.data.definition);
  if (problem) return problem;
  try {
    const report = await createReport(guard.supabase, viewerOf(guard), body.data);
    return NextResponse.json({ report }, { status: 201 });
  } catch (error) {
    return failure(error, "Create report");
  }
}
