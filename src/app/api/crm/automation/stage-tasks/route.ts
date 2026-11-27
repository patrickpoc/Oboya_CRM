import { NextResponse } from "next/server";
import { z } from "zod";
import type { StageTaskResponse, StageTasksResponse } from "@/lib/crm/automation/api-contract";
import { stageTaskSchema } from "@/lib/crm/automation/schemas";
import { STAGE_TASK_COLUMNS, fromDbRow, toDbRow, type StageTaskTemplate } from "@/lib/crm/automation/types";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { dbErrorResponse, jsonError, parseBody } from "@/lib/crm/setup/api.server";

export const dynamic = "force-dynamic";

const querySchema = z.object({ pipelineId: z.string().uuid().optional(), stageId: z.string().uuid().optional() });
const asTemplate = (row: unknown) => fromDbRow<StageTaskTemplate>(row as Record<string, unknown>);

export async function GET(request: Request) {
  const guard = await crmGuard("automation", "view");
  if (guard instanceof NextResponse) return guard;
  const sp = new URL(request.url).searchParams;
  const q = querySchema.safeParse({
    pipelineId: sp.get("pipelineId") || undefined,
    stageId: sp.get("stageId") || undefined,
  });
  if (!q.success) return jsonError(400, "invalid_input", "Invalid filters");

  let query = guard.supabase.from("crm_stage_task_templates").select(STAGE_TASK_COLUMNS);
  if (q.data.pipelineId) query = query.eq("pipeline_id", q.data.pipelineId);
  if (q.data.stageId) query = query.eq("stage_id", q.data.stageId);
  const { data, error } = await query.order("sort_order").order("id");
  if (error) return dbErrorResponse(error, "Stage tasks read");
  const res: StageTasksResponse = { templates: (data ?? []).map(asTemplate) };
  return NextResponse.json(res);
}

export async function POST(request: Request) {
  const guard = await crmGuard("automation", "create");
  if (guard instanceof NextResponse) return guard;
  const body = await parseBody(request, stageTaskSchema);
  if (body instanceof NextResponse) return body;

  const input = { ...body.data };
  if (input.sortOrder === undefined) {
    const { data: last } = await guard.supabase
      .from("crm_stage_task_templates")
      .select("sort_order")
      .eq("stage_id", input.stageId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    input.sortOrder = (last?.sort_order ?? 0) + 10;
  }
  const { data, error } = await guard.supabase
    .from("crm_stage_task_templates")
    .insert(toDbRow(input))
    .select(STAGE_TASK_COLUMNS)
    .single();
  if (error) return dbErrorResponse(error, "Stage task create");
  const res: StageTaskResponse = { template: asTemplate(data) };
  return NextResponse.json(res, { status: 201 });
}
