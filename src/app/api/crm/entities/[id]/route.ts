import { NextResponse } from "next/server";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { dbErrorResponse, isUuid, jsonError, parseBody, type IdParams } from "@/lib/crm/setup/api.server";
import { ENTITY_COLUMNS, toSetupEntity } from "@/lib/crm/setup/rows";
import { entitySchema } from "@/lib/crm/setup/schemas";

export async function PATCH(request: Request, { params }: IdParams) {
  const guard = await crmGuard("setup_companies", "edit");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "not_found", "Company not found");

  const body = await parseBody(request, entitySchema.partial());
  if (body instanceof NextResponse) return body;
  const patch = body.data;

  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.legalName !== undefined) update.legal_name = patch.legalName;
  if (patch.countryCode !== undefined) update.country_code = patch.countryCode;
  if (patch.taxId !== undefined) update.tax_id = patch.taxId;
  if (patch.defaultCurrency !== undefined) update.default_currency = patch.defaultCurrency;
  if (patch.active !== undefined) update.active = patch.active;
  if (Object.keys(update).length === 0) return jsonError(400, "invalid_input", "Nothing to update");

  const { data, error } = await guard.supabase
    .from("crm_entities")
    .update(update)
    .eq("id", id)
    .select(ENTITY_COLUMNS)
    .maybeSingle();
  if (error) return dbErrorResponse(error, "Company update");
  if (!data) return jsonError(404, "not_found", "Company not found");
  return NextResponse.json({ entity: toSetupEntity(data) });
}

/** Hard delete only when nothing references the company; otherwise 409 (deactivate instead). */
export async function DELETE(_request: Request, { params }: IdParams) {
  const guard = await crmGuard("setup_companies", "delete");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "not_found", "Company not found");

  const { data, error } = await guard.supabase.from("crm_entities").delete().eq("id", id).select("id");
  if (error) return dbErrorResponse(error, "Company delete");
  if (!data?.length) return jsonError(404, "not_found", "Company not found");
  return NextResponse.json({ ok: true });
}
