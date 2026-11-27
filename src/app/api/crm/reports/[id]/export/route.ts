import { NextResponse } from "next/server";
import { z } from "zod";
import { reportCsv } from "@/lib/crm/reports/csv";
import { getReport } from "@/lib/crm/reports/repository";
import {
  IdSchema,
  TzSchema,
  canOnObject,
  definitionProblem,
  failure,
  forbidden,
  invalidInput,
  notFound,
  reportsGuard,
  runOptions,
  viewerOf,
} from "@/lib/crm/reports/route";
import type { IdParams } from "@/lib/crm/setup/api.server";

export const dynamic = "force-dynamic";

const ExportQuerySchema = z.object({
  mode: z.enum(["rows", "grouped"]).default("rows"),
  tz: TzSchema,
});

/** GET text/csv: needs reports.export and export on the object's module; max 5000 rows. */
export async function GET(request: Request, { params }: IdParams) {
  const guard = await reportsGuard("export");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) return notFound();
  const query = ExportQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return invalidInput(query.error);
  try {
    const report = await getReport(guard.supabase, viewerOf(guard), id);
    if (!report) return notFound();
    if (!canOnObject(guard, report.definition.object, "view") || !canOnObject(guard, report.definition.object, "export")) {
      return forbidden();
    }
    const problem = definitionProblem(report.definition);
    if (problem) return problem;
    const csv = await reportCsv(
      guard.supabase,
      report.definition,
      query.data.mode,
      await runOptions(guard, query.data.tz)
    );
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="report-${report.definition.object}-${date}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return failure(error, "Export report");
  }
}
