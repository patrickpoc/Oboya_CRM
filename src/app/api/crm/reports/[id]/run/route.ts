import { NextResponse } from "next/server";
import { runReport } from "@/lib/crm/reports/engine";
import { getReport } from "@/lib/crm/reports/repository";
import {
  IdSchema,
  TzSchema,
  canOnObject,
  definitionProblem,
  failure,
  forbidden,
  notFound,
  reportsGuard,
  runOptions,
  viewerOf,
} from "@/lib/crm/reports/route";
import type { IdParams } from "@/lib/crm/setup/api.server";

export const dynamic = "force-dynamic";

/** GET: runs a saved report with the viewer's own visibility. */
export async function GET(request: Request, { params }: IdParams) {
  const guard = await reportsGuard("view");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) return notFound();
  const tz = TzSchema.safeParse(new URL(request.url).searchParams.get("tz") ?? undefined);
  try {
    const report = await getReport(guard.supabase, viewerOf(guard), id);
    if (!report) return notFound();
    if (!canOnObject(guard, report.definition.object, "view")) return forbidden();
    const problem = definitionProblem(report.definition);
    if (problem) return problem;
    const result = await runReport(
      guard.supabase,
      report.definition,
      await runOptions(guard, tz.success ? tz.data : undefined)
    );
    return NextResponse.json({ result });
  } catch (error) {
    return failure(error, "Run report");
  }
}
