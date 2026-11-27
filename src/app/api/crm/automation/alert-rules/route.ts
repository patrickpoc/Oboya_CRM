import { NextResponse } from "next/server";
import type { AlertRuleResponse, AlertRulesResponse } from "@/lib/crm/automation/api-contract";
import { alertRuleSchema } from "@/lib/crm/automation/schemas";
import { ALERT_RULE_COLUMNS, fromDbRow, toDbRow, type AlertRule } from "@/lib/crm/automation/types";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { dbErrorResponse, parseBody } from "@/lib/crm/setup/api.server";

export const dynamic = "force-dynamic";

const asRule = (row: unknown) => fromDbRow<AlertRule>(row as Record<string, unknown>);

export async function GET() {
  const guard = await crmGuard("automation", "view");
  if (guard instanceof NextResponse) return guard;
  const { data, error } = await guard.supabase
    .from("crm_alert_rules")
    .select(ALERT_RULE_COLUMNS)
    .order("kind")
    .order("created_at");
  if (error) return dbErrorResponse(error, "Alert rules read");
  const res: AlertRulesResponse = { rules: (data ?? []).map(asRule) };
  return NextResponse.json(res);
}

export async function POST(request: Request) {
  const guard = await crmGuard("automation", "create");
  if (guard instanceof NextResponse) return guard;
  const body = await parseBody(request, alertRuleSchema);
  if (body instanceof NextResponse) return body;
  const { data, error } = await guard.supabase
    .from("crm_alert_rules")
    .insert(toDbRow(body.data))
    .select(ALERT_RULE_COLUMNS)
    .single();
  if (error) return dbErrorResponse(error, "Alert rule create");
  const res: AlertRuleResponse = { rule: asRule(data) };
  return NextResponse.json(res, { status: 201 });
}
