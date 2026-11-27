import { NextResponse } from "next/server";
import type { LeadAssignPreviewResponse, LeadAssignResponse } from "@/lib/crm/automation/api-contract";
import { ASSIGNMENT_VIAS, type AssignmentVia } from "@/lib/crm/automation/types";
import { isRecordId, notFound } from "@/lib/crm/objects/route-helpers";
import { mapDbError } from "@/lib/crm/objects/errors";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";

type Ctx = { params: Promise<{ id: string }> };
type PgError = { code?: string; message?: string };

function fail(error: PgError, context: string) {
  const message = error.message ?? "";
  if (error.code === "54000") {
    return NextResponse.json({ error: "Too many requests", code: "rate_limited" }, { status: 429 });
  }
  if (/no_assignee/.test(message)) {
    return NextResponse.json({ error: "No assignee available", code: "no_assignee" }, { status: 422 });
  }
  if (/lead_converted|already_converted/.test(message)) {
    return NextResponse.json({ error: "Lead already converted", code: "lead_converted" }, { status: 409 });
  }
  const mapped = mapDbError(error);
  if (mapped.status >= 500) console.error(`[crm leads] ${context}:`, error.code, error.message);
  return NextResponse.json(mapped.body, { status: mapped.status });
}

const first = (data: unknown): Record<string, unknown> | null => {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === "object" ? (row as Record<string, unknown>) : null;
};
const via = (v: unknown): AssignmentVia =>
  (ASSIGNMENT_VIAS as readonly string[]).includes(v as string) ? (v as AssignmentVia) : "default";
const idOrNull = (v: unknown) => (typeof v === "string" ? v : null);

/** POST /api/crm/leads/:id/assign — leads.edit → rpc crm_apply_assignment_rules (re-checks everything). */
export async function POST(_request: Request, { params }: Ctx) {
  const guard = await crmGuard("leads", "edit");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isRecordId(id)) return notFound();

  const { data, error } = await guard.supabase.rpc("crm_apply_assignment_rules", { p_lead_id: id });
  if (error) return fail(error, "assign");
  const row = first(data);
  const ownerId = idOrNull(row?.owner_id);
  if (!row || !ownerId) {
    console.error("[crm leads] assign: unexpected RPC result");
    return NextResponse.json({ error: "Request failed", code: "unavailable" }, { status: 500 });
  }
  const body: LeadAssignResponse = { ownerId, ruleId: idOrNull(row.rule_id), via: via(row.via) };
  return NextResponse.json(body);
}

/** GET /api/crm/leads/:id/assign?preview=1 — who the rules would pick now (cursor not moved). */
export async function GET(request: Request, { params }: Ctx) {
  const guard = await crmGuard("leads", "edit");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isRecordId(id)) return notFound();
  if (new URL(request.url).searchParams.get("preview") !== "1") return notFound();

  const { data, error } = await guard.supabase.rpc("crm_assignment_preview_for_lead", { p_lead_id: id });
  if (error) return fail(error, "assign preview");
  const row = first(data);
  const body: LeadAssignPreviewResponse = { result: { ownerId: idOrNull(row?.owner_id), via: via(row?.via) } };
  return NextResponse.json(body);
}
