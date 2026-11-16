import { NextResponse } from "next/server";
import { opportunityConfig } from "@/lib/crm/objects/opportunity";
import { parseListQuery } from "@/lib/crm/objects/query";
import { errorResponse } from "@/lib/crm/objects/route-helpers";
import { PIPELINE_LIMIT, pipelineParams } from "@/lib/crm/opportunities/pipeline";
import { list } from "@/lib/crm/repositories/object-repository";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";

/** GET /api/crm/opportunities/pipeline?view=&entity_id=&close_date=from..to (kanban, up to 500 rows). */
export async function GET(request: Request) {
  const guard = await crmGuard("opportunities", "view");
  if (guard instanceof NextResponse) return guard;
  const source = Object.fromEntries(new URL(request.url).searchParams);
  const query = parseListQuery(opportunityConfig, pipelineParams(source), { maxPageSize: PIPELINE_LIMIT });
  try {
    const result = await list(guard.supabase, opportunityConfig, query, { userId: guard.user.id });
    return NextResponse.json(result);
  } catch (error) {
    return errorResponse(error, "opportunity pipeline");
  }
}
