import { NextResponse } from "next/server";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { dbErrorResponse, parseBody } from "@/lib/crm/setup/api.server";
import { TEAM_COLUMNS, toSetupTeam } from "@/lib/crm/setup/rows";
import { teamSchema } from "@/lib/crm/setup/schemas";

/** Teams live under Setup -> Roles (same module: setup_roles). */
export async function POST(request: Request) {
  const guard = await crmGuard("setup_roles", "create");
  if (guard instanceof NextResponse) return guard;

  const body = await parseBody(request, teamSchema);
  if (body instanceof NextResponse) return body;
  const input = body.data;

  const { data, error } = await guard.supabase
    .from("crm_teams")
    .insert({
      name: input.name,
      description: input.description ?? null,
      manager_id: input.managerId ?? null,
      active: input.active ?? true,
    })
    .select(TEAM_COLUMNS)
    .single();
  if (error) return dbErrorResponse(error, "Team create");
  return NextResponse.json({ team: toSetupTeam(data) }, { status: 201 });
}
