import { NextResponse } from "next/server";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { dbErrorResponse, jsonError, parseBody } from "@/lib/crm/setup/api.server";
import { ROLE_COLUMNS, TEAM_COLUMNS, toSetupRole, toSetupTeam } from "@/lib/crm/setup/rows";
import { roleCreateSchema } from "@/lib/crm/setup/schemas";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await crmGuard("setup_roles", "view");
  if (guard instanceof NextResponse) return guard;

  const [roles, teams, users] = await Promise.all([
    guard.supabase.from("crm_roles").select(ROLE_COLUMNS).order("sort_order").order("label"),
    guard.supabase.from("crm_teams").select(TEAM_COLUMNS).order("name"),
    guard.supabase.from("crm_users").select("id, full_name, email, role, team_id, status").order("full_name"),
  ]);
  const error = roles.error ?? teams.error ?? users.error;
  if (error) return dbErrorResponse(error, "Roles read");

  const userRows = users.data ?? [];
  return NextResponse.json({
    roles: (roles.data ?? []).map((r) => ({
      ...toSetupRole(r),
      userCount: userRows.filter((u) => u.role === r.id).length,
    })),
    teams: (teams.data ?? []).map((t) => ({
      ...toSetupTeam(t),
      memberCount: userRows.filter((u) => u.team_id === t.id).length,
    })),
    users: userRows.map((u) => ({
      id: u.id,
      fullName: u.full_name || u.email,
      status: u.status,
    })),
  });
}

export async function POST(request: Request) {
  const guard = await crmGuard("setup_roles", "create");
  if (guard instanceof NextResponse) return guard;

  const body = await parseBody(request, roleCreateSchema);
  if (body instanceof NextResponse) return body;
  const input = body.data;
  if (input.baseRole === input.id) return jsonError(400, "invalid_input", "Invalid base role");

  const { data, error } = await guard.supabase
    .from("crm_roles")
    .insert({
      id: input.id,
      label: input.label,
      description: input.description ?? null,
      visibility_scope: input.visibilityScope,
      can_write: input.canWrite,
      sort_order: 100,
    })
    .select(ROLE_COLUMNS)
    .single();
  if (error) return dbErrorResponse(error, "Role create");

  // A role missing from the matrix has no permissions: copy the base row.
  if (input.baseRole) {
    const { data: ac, error: acError } = await guard.supabase
      .from("crm_access_control")
      .select("matrix")
      .eq("id", true)
      .maybeSingle();
    const matrix = (ac?.matrix ?? {}) as Record<string, unknown>;
    const baseRow = input.baseRole === "super_admin" ? undefined : matrix[input.baseRole];
    if (!acError && baseRow) {
      // Single-statement jsonb_set in the DB: no read-modify-write race on the matrix.
      const { error: saveError } = await guard.supabase.rpc("crm_set_role_permissions", {
        p_role: input.id,
        p_permissions: baseRow,
      });
      if (saveError) console.error("Copying base permissions failed:", saveError.code);
    }
  }

  return NextResponse.json({ role: toSetupRole(data) }, { status: 201 });
}
