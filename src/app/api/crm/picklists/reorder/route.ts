import { NextResponse } from "next/server";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { dbErrorResponse, jsonError, parseBody } from "@/lib/crm/setup/api.server";
import { PICKLIST_COLUMNS, toSetupPicklistValue } from "@/lib/crm/setup/rows";
import { picklistReorderSchema } from "@/lib/crm/setup/schemas";

export async function POST(request: Request) {
  const guard = await crmGuard("setup_picklists", "edit");
  if (guard instanceof NextResponse) return guard;
  const body = await parseBody(request, picklistReorderSchema);
  if (body instanceof NextResponse) return body;
  const { picklist, ids } = body.data;

  // One RPC: validates the full id set and renumbers in a single statement.
  const { error } = await guard.supabase.rpc("crm_reorder_picklist", { p_picklist: picklist, p_ids: ids });
  if (error?.code === "22023") {
    return jsonError(409, "invalid_order", "The list changed; reload and try again");
  }
  if (error) return dbErrorResponse(error, "Picklist reorder");

  const { data, error: readError } = await guard.supabase
    .from("crm_picklist_values")
    .select(PICKLIST_COLUMNS)
    .eq("picklist", picklist)
    .order("sort_order");
  if (readError) return dbErrorResponse(readError, "Picklist read");
  return NextResponse.json({ values: (data ?? []).map(toSetupPicklistValue) });
}
