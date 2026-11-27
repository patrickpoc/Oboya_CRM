import { NextResponse } from "next/server";
import { z } from "zod";
import { ReportDefinitionSchema } from "@/lib/crm/reports/definition";
import { runReport } from "@/lib/crm/reports/engine";
import {
  TzSchema,
  canOnObject,
  definitionProblem,
  failure,
  forbidden,
  reportsGuard,
  runOptions,
} from "@/lib/crm/reports/route";
import { parseBody } from "@/lib/crm/setup/api.server";

export const dynamic = "force-dynamic";

const RunBodySchema = z.object({ definition: ReportDefinitionSchema, tz: TzSchema });

/** POST: preview of an unsaved definition. */
export async function POST(request: Request) {
  const guard = await reportsGuard("view");
  if (guard instanceof NextResponse) return guard;
  const body = await parseBody(request, RunBodySchema);
  if (body instanceof NextResponse) return body;
  const { definition, tz } = body.data;
  if (!canOnObject(guard, definition.object, "view")) return forbidden();
  const problem = definitionProblem(definition);
  if (problem) return problem;
  try {
    const result = await runReport(guard.supabase, definition, await runOptions(guard, tz));
    return NextResponse.json({ result });
  } catch (error) {
    return failure(error, "Run report");
  }
}
