import { NextResponse } from "next/server";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { dbErrorResponse, isUuid, jsonError, parseBody, type IdParams } from "@/lib/crm/setup/api.server";
import { PICKLIST_COLUMNS, toSetupPicklistValue } from "@/lib/crm/setup/rows";
import { picklistPatchSchema } from "@/lib/crm/setup/schemas";

/** Label and active only: `value` is stored on records, so it never changes. */
export async function PATCH(request: Request, { params }: IdParams) {
  const guard = await crmGuard("setup_picklists", "edit");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "not_found", "Value not found");

  const body = await parseBody(request, picklistPatchSchema);
  if (body instanceof NextResponse) return body;
  const update: Record<string, unknown> = {};
  if (body.data.label !== undefined) update.label = body.data.label;
  if (body.data.active !== undefined) update.active = body.data.active;
  if (Object.keys(update).length === 0) return jsonError(400, "invalid_input", "Nothing to update");

  const { data, error } = await guard.supabase
    .from("crm_picklist_values")
    .update(update)
    .eq("id", id)
    .select(PICKLIST_COLUMNS)
    .maybeSingle();
  if (error) return dbErrorResponse(error, "Picklist value update");
  if (!data) return jsonError(404, "not_found", "Value not found");
  return NextResponse.json({ value: toSetupPicklistValue(data) });
}
