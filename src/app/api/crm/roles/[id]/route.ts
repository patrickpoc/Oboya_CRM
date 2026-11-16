import { NextResponse } from "next/server";
import { isValidRoleId } from "@/lib/crm/permissions/access-types";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { dbErrorResponse, jsonError, parseBody, type IdParams } from "@/lib/crm/setup/api.server";
import { ROLE_COLUMNS, toSetupRole } from "@/lib/crm/setup/rows";
import { rolePatchSchema } from "@/lib/crm/setup/schemas";

export async function PATCH(request: Request, { params }: IdParams) {
  const guard = await crmGuard("setup_roles", "edit");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isValidRoleId(id)) return jsonError(404, "not_found", "Role not found");

  const body = await parseBody(request, rolePatchSchema);
  if (body instanceof NextResponse) return body;
  const patch = body.data;

  if (
    id === "super_admin" &&
    ((patch.visibilityScope && patch.visibilityScope !== "all") || patch.canWrite === false || patch.active === false)
  ) {
    return jsonError(409, "super_admin_locked", "Super Admin keeps scope all, write access and stays active");
  }

  const update: Record<string, unknown> = {};
  if (patch.label !== undefined) update.label = patch.label;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.visibilityScope !== undefined) update.visibility_scope = patch.visibilityScope;
  if (patch.canWrite !== undefined) update.can_write = patch.canWrite;
  if (patch.active !== undefined) update.active = patch.active;
  if (Object.keys(update).length === 0) return jsonError(400, "invalid_input", "Nothing to update");

  const { data, error } = await guard.supabase
    .from("crm_roles")
    .update(update)
    .eq("id", id)
    .select(ROLE_COLUMNS)
    .maybeSingle();
  if (error) return dbErrorResponse(error, "Role update");
  if (!data) return jsonError(404, "not_found", "Role not found");
  return NextResponse.json({ role: toSetupRole(data) });
}

export async function DELETE(_request: Request, { params }: IdParams) {
  const guard = await crmGuard("setup_roles", "delete");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isValidRoleId(id)) return jsonError(404, "not_found", "Role not found");

  const { data: role, error: readError } = await guard.supabase
    .from("crm_roles")
    .select("id, system")
    .eq("id", id)
    .maybeSingle();
  if (readError) return dbErrorResponse(readError, "Role read");
  if (!role) return jsonError(404, "not_found", "Role not found");
  if (role.system) return jsonError(409, "system_role", "System roles cannot be deleted");

  const { count } = await guard.supabase
    .from("crm_users")
    .select("id", { count: "exact", head: true })
    .eq("role", id);
  if ((count ?? 0) > 0) return jsonError(409, "role_in_use", "Users still have this role");

  // One transaction in the DB: drops the matrix row, then the role.
  const { error } = await guard.supabase.rpc("crm_delete_role", { p_role: id });
  if (error?.code === "23503") return jsonError(409, "role_in_use", "Users still have this role");
  if (error?.code === "42501" && error.message === "system_role") {
    return jsonError(409, "system_role", "System roles cannot be deleted");
  }
  if (error) return dbErrorResponse(error, "Role delete");
  return NextResponse.json({ ok: true });
}
