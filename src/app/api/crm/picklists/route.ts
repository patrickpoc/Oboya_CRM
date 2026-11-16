import { NextResponse } from "next/server";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { dbErrorResponse, parseBody } from "@/lib/crm/setup/api.server";
import { PICKLISTS } from "@/lib/crm/setup/picklists";
import { PICKLIST_COLUMNS, toSetupPicklistValue } from "@/lib/crm/setup/rows";
import { picklistCreateSchema } from "@/lib/crm/setup/schemas";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await crmGuard("setup_picklists", "view");
  if (guard instanceof NextResponse) return guard;
  const { data, error } = await guard.supabase
    .from("crm_picklist_values")
    .select(PICKLIST_COLUMNS)
    .in("picklist", [...PICKLISTS])
    .order("picklist")
    .order("sort_order")
    .order("label");
  if (error) return dbErrorResponse(error, "Picklists read");
  return NextResponse.json({ values: (data ?? []).map(toSetupPicklistValue) });
}

export async function POST(request: Request) {
  const guard = await crmGuard("setup_picklists", "create");
  if (guard instanceof NextResponse) return guard;
  const body = await parseBody(request, picklistCreateSchema);
  if (body instanceof NextResponse) return body;
  const input = body.data;

  const { data: last } = await guard.supabase
    .from("crm_picklist_values")
    .select("sort_order")
    .eq("picklist", input.picklist)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await guard.supabase
    .from("crm_picklist_values")
    .insert({
      picklist: input.picklist,
      value: input.value,
      label: input.label,
      sort_order: (last?.sort_order ?? 0) + 10,
      active: true,
    })
    .select(PICKLIST_COLUMNS)
    .single();
  if (error) return dbErrorResponse(error, "Picklist value create");
  return NextResponse.json({ value: toSetupPicklistValue(data) }, { status: 201 });
}
