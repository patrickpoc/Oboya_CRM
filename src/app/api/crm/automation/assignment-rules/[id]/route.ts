import { NextResponse } from "next/server";
import { parsePatch } from "@/lib/crm/automation/api.server";
import type { AssignmentRuleResponse, OkResponse } from "@/lib/crm/automation/api-contract";
import { assignmentRulePatchSchema, isAssignmentTargetConsistent } from "@/lib/crm/automation/schemas";
import { ASSIGNMENT_RULE_COLUMNS, fromDbRow, toDbRow, type AssignmentRule } from "@/lib/crm/automation/types";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { dbErrorResponse, isUuid, jsonError, type IdParams } from "@/lib/crm/setup/api.server";

const asRule = (row: unknown) => fromDbRow<AssignmentRule>(row as Record<string, unknown>);

export async function PATCH(request: Request, { params }: IdParams) {
  const guard = await crmGuard("automation", "edit");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "not_found", "Rule not found");
  const body = await parsePatch(request, assignmentRulePatchSchema);
  if (body instanceof NextResponse) return body;

  const stored = await guard.supabase
    .from("crm_assignment_rules")
    .select(ASSIGNMENT_RULE_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (stored.error) return dbErrorResponse(stored.error, "Assignment rule read");
  if (!stored.data) return jsonError(404, "not_found", "Rule not found");

  const merged = { ...asRule(stored.data), ...body.data };
  if (!isAssignmentTargetConsistent(merged)) {
    return jsonError(400, "invalid_input", "Invalid input", { fields: { targetType: "target_inconsistent" } });
  }

  const { data, error } = await guard.supabase
    .from("crm_assignment_rules")
    .update(toDbRow(body.data))
    .eq("id", id)
    .select(ASSIGNMENT_RULE_COLUMNS)
    .maybeSingle();
  if (error) return dbErrorResponse(error, "Assignment rule update");
  if (!data) return jsonError(404, "not_found", "Rule not found");
  const res: AssignmentRuleResponse = { rule: asRule(data) };
  return NextResponse.json(res);
}

export async function DELETE(_request: Request, { params }: IdParams) {
  const guard = await crmGuard("automation", "delete");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "not_found", "Rule not found");
  const { data, error } = await guard.supabase.from("crm_assignment_rules").delete().eq("id", id).select("id");
  if (error) return dbErrorResponse(error, "Assignment rule delete");
  if (!data?.length) return jsonError(404, "not_found", "Rule not found");
  const res: OkResponse = { ok: true };
  return NextResponse.json(res);
}
