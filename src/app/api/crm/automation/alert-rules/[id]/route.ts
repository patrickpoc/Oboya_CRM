import { NextResponse } from "next/server";
import { parsePatch } from "@/lib/crm/automation/api.server";
import type { AlertRuleResponse, OkResponse } from "@/lib/crm/automation/api-contract";
import { alertRulePatchSchema } from "@/lib/crm/automation/schemas";
import { ALERT_RULE_COLUMNS, fromDbRow, toDbRow, type AlertRule } from "@/lib/crm/automation/types";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { dbErrorResponse, isUuid, jsonError, type IdParams } from "@/lib/crm/setup/api.server";

export async function PATCH(request: Request, { params }: IdParams) {
  const guard = await crmGuard("automation", "edit");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "not_found", "Rule not found");
  const body = await parsePatch(request, alertRulePatchSchema);
  if (body instanceof NextResponse) return body;
  const { data, error } = await guard.supabase
    .from("crm_alert_rules")
    .update(toDbRow(body.data))
    .eq("id", id)
    .select(ALERT_RULE_COLUMNS)
    .maybeSingle();
  if (error) return dbErrorResponse(error, "Alert rule update");
  if (!data) return jsonError(404, "not_found", "Rule not found");
  const res: AlertRuleResponse = { rule: fromDbRow<AlertRule>(data as unknown as Record<string, unknown>) };
  return NextResponse.json(res);
}

export async function DELETE(_request: Request, { params }: IdParams) {
  const guard = await crmGuard("automation", "delete");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "not_found", "Rule not found");
  const { data, error } = await guard.supabase.from("crm_alert_rules").delete().eq("id", id).select("id");
  if (error) return dbErrorResponse(error, "Alert rule delete");
  if (!data?.length) return jsonError(404, "not_found", "Rule not found");
  const res: OkResponse = { ok: true };
  return NextResponse.json(res);
}
