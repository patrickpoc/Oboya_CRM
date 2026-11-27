import { NextResponse } from "next/server";
import { invalidOrder } from "@/lib/crm/automation/api.server";
import type { OkResponse } from "@/lib/crm/automation/api-contract";
import { reorderSchema } from "@/lib/crm/automation/schemas";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { dbErrorResponse, parseBody } from "@/lib/crm/setup/api.server";

export async function POST(request: Request) {
  const guard = await crmGuard("automation", "edit");
  if (guard instanceof NextResponse) return guard;
  const body = await parseBody(request, reorderSchema);
  if (body instanceof NextResponse) return body;
  const { error } = await guard.supabase.rpc("crm_reorder_assignment_rules", { p_ids: body.data.ids });
  if (error?.code === "22023") return invalidOrder();
  if (error) return dbErrorResponse(error, "Assignment rules reorder");
  const res: OkResponse = { ok: true };
  return NextResponse.json(res);
}
