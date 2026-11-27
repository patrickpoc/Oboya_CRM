import { NextResponse } from "next/server";
import type { AssignmentPreviewResponse } from "@/lib/crm/automation/api-contract";
import { assignmentPreviewSchema } from "@/lib/crm/automation/schemas";
import { ASSIGNMENT_VIAS, type AssignmentVia } from "@/lib/crm/automation/types";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { dbErrorResponse, parseBody } from "@/lib/crm/setup/api.server";

export async function POST(request: Request) {
  const guard = await crmGuard("automation", "view");
  if (guard instanceof NextResponse) return guard;
  const body = await parseBody(request, assignmentPreviewSchema);
  if (body instanceof NextResponse) return body;
  const { data, error } = await guard.supabase.rpc("crm_assignment_preview", {
    p_country: body.data.countryCode ?? null,
    p_entity: body.data.entityId ?? null,
    p_source: body.data.source ?? null,
  });
  if (error) return dbErrorResponse(error, "Assignment preview");
  const row = (data ?? {}) as { owner_id?: string | null; rule_id?: string | null; via?: string };
  const via = (ASSIGNMENT_VIAS as readonly string[]).includes(row.via ?? "") ? (row.via as AssignmentVia) : "default";
  const res: AssignmentPreviewResponse = {
    result: { ownerId: row.owner_id ?? null, ruleId: row.rule_id ?? null, via },
  };
  return NextResponse.json(res);
}
