import { NextResponse } from "next/server";
import { leadStatusPatch, leadStatusSchema } from "@/lib/crm/leads/status";
import { leadConfig } from "@/lib/crm/objects/lead";
import { errorResponse, invalid, isRecordId, notFound, readJson } from "@/lib/crm/objects/route-helpers";
import { fieldErrors } from "@/lib/crm/objects/schema";
import { update } from "@/lib/crm/repositories/object-repository";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/crm/leads/:id/status { status, unqualifiedReason? } — the lead
 * path. `status` is not editable through the generic PATCH. crmGuard(leads.edit)
 * → zod → repository update (beforeUpdate rules: converted = 422
 * `lead_converted`, Unqualified without reason = 422 `reason_required`).
 */
export async function POST(request: Request, { params }: Ctx) {
  const guard = await crmGuard("leads", "edit");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isRecordId(id)) return notFound();
  const parsed = leadStatusSchema.safeParse(await readJson(request));
  if (!parsed.success) return invalid(fieldErrors(parsed.error));

  try {
    const record = await update(guard.supabase, leadConfig, id, leadStatusPatch(parsed.data));
    if (!record) return notFound();
    return NextResponse.json({ record });
  } catch (error) {
    return errorResponse(error, "lead status");
  }
}
