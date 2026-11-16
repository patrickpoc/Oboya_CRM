import { NextResponse } from "next/server";
import { parseAccessMatrix } from "@/lib/crm/permissions/access-store";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { dbErrorResponse, jsonError, parseBody } from "@/lib/crm/setup/api.server";
import { serializeMatrix } from "@/lib/crm/setup/matrix";
import { ROLE_COLUMNS, toSetupRole } from "@/lib/crm/setup/rows";
import { accessControlPutSchema } from "@/lib/crm/setup/schemas";
import type { CrmSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

async function load(supabase: CrmSupabaseClient) {
  const [ac, roles] = await Promise.all([
    supabase.from("crm_access_control").select("matrix, updated_at").eq("id", true).maybeSingle(),
    supabase.from("crm_roles").select(ROLE_COLUMNS).order("sort_order").order("label"),
  ]);
  if (ac.error || roles.error) return { error: ac.error ?? roles.error } as const;
  const roleRows = (roles.data ?? []).map(toSetupRole);
  // Throws on a non-object matrix: the caller fails closed (500).
  const matrix = parseAccessMatrix(ac.data ? ac.data.matrix : null);
  return {
    roles: roleRows,
    matrix: serializeMatrix(matrix, roleRows.map((r) => r.id)),
    updatedAt: ac.data?.updated_at ?? null,
  } as const;
}

export async function GET() {
  const guard = await crmGuard("setup_access", "view");
  if (guard instanceof NextResponse) return guard;
  try {
    const result = await load(guard.supabase);
    if ("error" in result) return dbErrorResponse(result.error, "Access control read");
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Access control parse failed:", error);
    return jsonError(500, "failed", "Access control is malformed");
  }
}

export async function PUT(request: Request) {
  const guard = await crmGuard("setup_access", "edit");
  if (guard instanceof NextResponse) return guard;

  const body = await parseBody(request, accessControlPutSchema);
  if (body instanceof NextResponse) return body;

  let current;
  try {
    current = await load(guard.supabase);
  } catch {
    current = null;
  }
  if (!current || "error" in current) return jsonError(503, "unavailable", "Access control unavailable");

  const roleIds = current.roles.map((r) => r.id);
  const unknown = Object.keys(body.data.matrix).filter((id) => !roleIds.includes(id));
  if (unknown.length > 0) return jsonError(400, "unknown_role", `Unknown roles: ${unknown.join(", ")}`);

  // Rows not sent keep their stored value; super_admin is always full.
  const next = serializeMatrix({ ...current.matrix, ...body.data.matrix }, roleIds);

  const { error } = await guard.supabase
    .from("crm_access_control")
    .upsert({ id: true, matrix: next, updated_by: guard.user.id }, { onConflict: "id" });
  if (error) return dbErrorResponse(error, "Access control save");
  return NextResponse.json({ matrix: next, roles: current.roles });
}
