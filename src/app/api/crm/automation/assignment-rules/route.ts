import { NextResponse } from "next/server";
import { assignmentRuleSchema } from "@/lib/crm/automation/schemas";
import type { AssignmentRulesResponse, AssignmentRuleResponse } from "@/lib/crm/automation/api-contract";
import { ASSIGNMENT_RULE_COLUMNS, fromDbRow, toDbRow, type AssignmentRule } from "@/lib/crm/automation/types";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { dbErrorResponse, parseBody } from "@/lib/crm/setup/api.server";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await crmGuard("automation", "view");
  if (guard instanceof NextResponse) return guard;
  const { data, error } = await guard.supabase
    .from("crm_assignment_rules")
    .select(ASSIGNMENT_RULE_COLUMNS)
    .order("sort_order")
    .order("id");
  if (error) return dbErrorResponse(error, "Assignment rules read");
  const body: AssignmentRulesResponse = {
    rules: (data ?? []).map((r) => fromDbRow<AssignmentRule>(r as unknown as Record<string, unknown>)),
  };
  return NextResponse.json(body);
}

export async function POST(request: Request) {
  const guard = await crmGuard("automation", "create");
  if (guard instanceof NextResponse) return guard;
  const body = await parseBody(request, assignmentRuleSchema);
  if (body instanceof NextResponse) return body;

  const input = { ...body.data };
  if (input.sortOrder === undefined) {
    const { data: last } = await guard.supabase
      .from("crm_assignment_rules")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    input.sortOrder = (last?.sort_order ?? 0) + 10;
  }
  const { data, error } = await guard.supabase
    .from("crm_assignment_rules")
    .insert(toDbRow(input))
    .select(ASSIGNMENT_RULE_COLUMNS)
    .single();
  if (error) return dbErrorResponse(error, "Assignment rule create");
  const res: AssignmentRuleResponse = { rule: fromDbRow<AssignmentRule>(data as unknown as Record<string, unknown>) };
  return NextResponse.json(res, { status: 201 });
}
