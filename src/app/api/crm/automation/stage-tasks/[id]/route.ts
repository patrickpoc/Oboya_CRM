import { NextResponse } from "next/server";
import { parsePatch } from "@/lib/crm/automation/api.server";
import type { OkResponse, StageTaskResponse } from "@/lib/crm/automation/api-contract";
import { stageTaskPatchSchema } from "@/lib/crm/automation/schemas";
import { STAGE_TASK_COLUMNS, fromDbRow, toDbRow, type StageTaskTemplate } from "@/lib/crm/automation/types";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { dbErrorResponse, isUuid, jsonError, type IdParams } from "@/lib/crm/setup/api.server";

const asTemplate = (row: unknown) => fromDbRow<StageTaskTemplate>(row as Record<string, unknown>);

export async function PATCH(request: Request, { params }: IdParams) {
  const guard = await crmGuard("automation", "edit");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "not_found", "Template not found");
  const body = await parsePatch(request, stageTaskPatchSchema);
  if (body instanceof NextResponse) return body;

  const stored = await guard.supabase.from("crm_stage_task_templates").select(STAGE_TASK_COLUMNS).eq("id", id).maybeSingle();
  if (stored.error) return dbErrorResponse(stored.error, "Stage task read");
  if (!stored.data) return jsonError(404, "not_found", "Template not found");
  const merged = { ...asTemplate(stored.data), ...body.data };
  if (merged.assigneeType === "user" && !merged.assigneeUserId) {
    return jsonError(400, "invalid_input", "Invalid input", { fields: { assigneeUserId: "assignee_inconsistent" } });
  }

  const { data, error } = await guard.supabase
    .from("crm_stage_task_templates")
    .update(toDbRow(body.data))
    .eq("id", id)
    .select(STAGE_TASK_COLUMNS)
    .maybeSingle();
  if (error) return dbErrorResponse(error, "Stage task update");
  if (!data) return jsonError(404, "not_found", "Template not found");
  const res: StageTaskResponse = { template: asTemplate(data) };
  return NextResponse.json(res);
}

export async function DELETE(_request: Request, { params }: IdParams) {
  const guard = await crmGuard("automation", "delete");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "not_found", "Template not found");
  const { data, error } = await guard.supabase.from("crm_stage_task_templates").delete().eq("id", id).select("id");
  if (error) return dbErrorResponse(error, "Stage task delete");
  if (!data?.length) return jsonError(404, "not_found", "Template not found");
  const res: OkResponse = { ok: true };
  return NextResponse.json(res);
}
