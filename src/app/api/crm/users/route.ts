import { NextResponse } from "next/server";
import { listCasdoorAccessRequests } from "@/lib/crm/server/admin-only/casdoor-session";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import {
  AuthUserExistsError,
  createAuthUserWithTemporaryPassword,
  deleteAuthUser,
} from "@/lib/crm/server/admin-only/users-admin";
import { dbErrorResponse, jsonError, parseBody } from "@/lib/crm/setup/api.server";
import {
  ROLE_COLUMNS,
  TEAM_COLUMNS,
  USER_COLUMNS,
  toSetupRole,
  toSetupTeam,
  toSetupUser,
} from "@/lib/crm/setup/rows";
import { userCreateSchema } from "@/lib/crm/setup/schemas";
import { canAssignRole } from "@/lib/crm/setup/users";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await crmGuard("setup_users", "view");
  if (guard instanceof NextResponse) return guard;

  const [users, roles, teams, requests] = await Promise.all([
    guard.supabase.from("crm_users").select(USER_COLUMNS).order("full_name"),
    guard.supabase.from("crm_roles").select(ROLE_COLUMNS).order("sort_order"),
    guard.supabase.from("crm_teams").select(TEAM_COLUMNS).order("name"),
    // Review queue is optional until the Casdoor migration has been applied.
    listCasdoorAccessRequests().catch(() => []),
  ]);
  const error = users.error ?? roles.error ?? teams.error;
  if (error) return dbErrorResponse(error, "Users read");

  return NextResponse.json({
    users: (users.data ?? []).map(toSetupUser),
    roles: (roles.data ?? []).map(toSetupRole),
    teams: (teams.data ?? []).map(toSetupTeam),
    matrix: guard.matrix,
    casdoorRequests: requests,
  });
}

export async function POST(request: Request) {
  const guard = await crmGuard("setup_users", "create");
  if (guard instanceof NextResponse) return guard;
  // Creating/editing users touches auth (service role) and access: super admins only.
  if (guard.user.role !== "super_admin") return jsonError(403, "forbidden", "Forbidden");

  const body = await parseBody(request, userCreateSchema);
  if (body instanceof NextResponse) return body;
  const input = body.data;

  if (!canAssignRole(guard.user.role, input.role)) {
    return jsonError(403, "super_admin_only", "Only a super admin can assign the Super Admin role");
  }
  const { data: role, error: roleError } = await guard.supabase
    .from("crm_roles")
    .select("id, active")
    .eq("id", input.role)
    .maybeSingle();
  if (roleError) return dbErrorResponse(roleError, "Role read");
  if (!role || !role.active) return jsonError(400, "invalid_role", "Unknown or inactive role");

  let created: { id: string; temporaryPassword: string };
  try {
    created = await createAuthUserWithTemporaryPassword({ email: input.email, fullName: input.fullName });
  } catch (error) {
    if (error instanceof AuthUserExistsError) return jsonError(409, "email_exists", error.message);
    console.error("Auth user creation failed:", error);
    return jsonError(500, "failed", "Failed to create user");
  }

  // User-scoped write: RLS + crm_users_guard decide who may activate users.
  const { data, error } = await guard.supabase
    .from("crm_users")
    .upsert(
      {
        id: created.id,
        email: input.email,
        full_name: input.fullName,
        title: input.title ?? null,
        role: input.role,
        team_id: input.teamId ?? null,
        status: "active",
        locale: input.locale ?? "en",
        receives_inbound: input.receivesInbound ?? false,
      },
      { onConflict: "id" }
    )
    .select(USER_COLUMNS)
    .maybeSingle();

  if (error || !data) {
    await deleteAuthUser(created.id).catch((rollbackError) =>
      console.error("Rollback of auth user failed:", rollbackError)
    );
    return error ? dbErrorResponse(error, "User create") : jsonError(403, "forbidden", "Forbidden");
  }

  return NextResponse.json(
    { user: toSetupUser(data), temporaryPassword: created.temporaryPassword },
    { status: 201, headers: { "Cache-Control": "no-store" } }
  );
}
