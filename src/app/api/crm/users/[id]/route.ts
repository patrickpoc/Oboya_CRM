import { NextResponse } from "next/server";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { dbErrorResponse, isUuid, jsonError, parseBody, type IdParams } from "@/lib/crm/setup/api.server";
import { normalizeOverrides } from "@/lib/crm/setup/matrix";
import { USER_COLUMNS, toSetupUser } from "@/lib/crm/setup/rows";
import { userPatchSchema } from "@/lib/crm/setup/schemas";
import { checkUserUpdate } from "@/lib/crm/setup/users";

const GUARD_MESSAGES = {
  self_role: "You cannot change your own role",
  self_status: "You cannot disable your own account",
  last_super_admin: "At least one active super admin is required",
  super_admin_only: "Only a super admin can change super admin access",
} as const;

export async function PATCH(request: Request, { params }: IdParams) {
  const guard = await crmGuard("setup_users", "edit");
  if (guard instanceof NextResponse) return guard;
  // Creating/editing users touches auth (service role) and access: super admins only.
  if (guard.user.role !== "super_admin") return jsonError(403, "forbidden", "Forbidden");
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "not_found", "User not found");

  const body = await parseBody(request, userPatchSchema);
  if (body instanceof NextResponse) return body;
  const patch = body.data;

  const [targetRes, adminsRes] = await Promise.all([
    guard.supabase.from("crm_users").select("id, role, status").eq("id", id).maybeSingle(),
    guard.supabase.from("crm_users").select("id").eq("role", "super_admin").eq("status", "active"),
  ]);
  if (targetRes.error || adminsRes.error) {
    return dbErrorResponse(targetRes.error ?? adminsRes.error, "User read");
  }
  if (!targetRes.data) return jsonError(404, "not_found", "User not found");

  const guardError = checkUserUpdate({
    actor: { id: guard.user.id, role: guard.user.role },
    target: {
      id: targetRes.data.id,
      role: targetRes.data.role,
      status: targetRes.data.status === "active" ? "active" : "disabled",
    },
    patch: { role: patch.role, status: patch.status },
    activeSuperAdminIds: (adminsRes.data ?? []).map((u) => u.id),
  });
  if (guardError) return jsonError(409, guardError, GUARD_MESSAGES[guardError]);

  if (patch.role !== undefined && patch.role !== targetRes.data.role) {
    const { data: role } = await guard.supabase.from("crm_roles").select("active").eq("id", patch.role).maybeSingle();
    if (!role?.active) return jsonError(400, "invalid_role", "Unknown or inactive role");
  }

  const update: Record<string, unknown> = {};
  if (patch.fullName !== undefined) update.full_name = patch.fullName;
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.phone !== undefined) update.phone = patch.phone;
  if (patch.role !== undefined) update.role = patch.role;
  if (patch.teamId !== undefined) update.team_id = patch.teamId;
  if (patch.status !== undefined) update.status = patch.status;
  if (patch.locale !== undefined) update.locale = patch.locale;
  if (patch.receivesInbound !== undefined) update.receives_inbound = patch.receivesInbound;
  if (patch.permissionOverrides !== undefined) {
    update.permission_overrides = normalizeOverrides(patch.permissionOverrides);
  }
  if (Object.keys(update).length === 0) return jsonError(400, "invalid_input", "Nothing to update");

  const { data, error } = await guard.supabase
    .from("crm_users")
    .update(update)
    .eq("id", id)
    .select(USER_COLUMNS)
    .maybeSingle();
  if (error) return dbErrorResponse(error, "User update");
  if (!data) return jsonError(403, "forbidden", "Forbidden");
  return NextResponse.json({ user: toSetupUser(data) });
}
