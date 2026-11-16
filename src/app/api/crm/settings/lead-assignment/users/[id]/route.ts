import { NextResponse } from "next/server";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { dbErrorResponse, isUuid, jsonError, parseBody, type IdParams } from "@/lib/crm/setup/api.server";
import { receivesInboundSchema } from "@/lib/crm/setup/schemas";

/** Toggles crm_users.receives_inbound (round-robin pool). */
export async function PATCH(request: Request, { params }: IdParams) {
  const guard = await crmGuard("setup_lead_assignment", "edit");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "not_found", "User not found");

  const body = await parseBody(request, receivesInboundSchema);
  if (body instanceof NextResponse) return body;

  const { data, error } = await guard.supabase
    .from("crm_users")
    .update({ receives_inbound: body.data.receivesInbound })
    .eq("id", id)
    .select("id, receives_inbound")
    .maybeSingle();
  if (error) return dbErrorResponse(error, "User update");
  if (!data) return jsonError(404, "not_found", "User not found");
  return NextResponse.json({ id: data.id, receivesInbound: data.receives_inbound });
}
