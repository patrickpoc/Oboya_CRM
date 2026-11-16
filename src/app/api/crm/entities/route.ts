import { NextResponse } from "next/server";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { dbErrorResponse, parseBody } from "@/lib/crm/setup/api.server";
import { ENTITY_COLUMNS, toSetupEntity } from "@/lib/crm/setup/rows";
import { entitySchema } from "@/lib/crm/setup/schemas";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await crmGuard("setup_companies", "view");
  if (guard instanceof NextResponse) return guard;
  const { data, error } = await guard.supabase
    .from("crm_entities")
    .select(ENTITY_COLUMNS)
    .order("sort_order")
    .order("name");
  if (error) return dbErrorResponse(error, "Companies read");
  return NextResponse.json({ entities: (data ?? []).map(toSetupEntity) });
}

export async function POST(request: Request) {
  const guard = await crmGuard("setup_companies", "create");
  if (guard instanceof NextResponse) return guard;
  const body = await parseBody(request, entitySchema);
  if (body instanceof NextResponse) return body;
  const input = body.data;

  const { data: last } = await guard.supabase
    .from("crm_entities")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await guard.supabase
    .from("crm_entities")
    .insert({
      name: input.name,
      legal_name: input.legalName ?? null,
      country_code: input.countryCode ?? null,
      tax_id: input.taxId ?? null,
      default_currency: input.defaultCurrency,
      active: input.active ?? true,
      sort_order: (last?.sort_order ?? 0) + 10,
    })
    .select(ENTITY_COLUMNS)
    .single();
  if (error) return dbErrorResponse(error, "Company create");
  return NextResponse.json({ entity: toSetupEntity(data) }, { status: 201 });
}
