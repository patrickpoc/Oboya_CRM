import { NextResponse } from "next/server";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { dbErrorResponse, isUuid, jsonError, parseBody, type IdParams } from "@/lib/crm/setup/api.server";
import { TEAM_COLUMNS, toSetupTeam } from "@/lib/crm/setup/rows";
import { teamSchema } from "@/lib/crm/setup/schemas";

export async function PATCH(request: Request, { params }: IdParams) {
  const guard = await crmGuard("setup_roles", "edit");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "not_found", "Team not found");

  const body = await parseBody(request, teamSchema.partial());
  if (body instanceof NextResponse) return body;
  const patch = body.data;

  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.managerId !== undefined) update.manager_id = patch.managerId;
  if (patch.active !== undefined) update.active = patch.active;
  if (Object.keys(update).length === 0) return jsonError(400, "invalid_input", "Nothing to update");

  const { data, error } = await guard.supabase
    .from("crm_teams")
    .update(update)
    .eq("id", id)
    .select(TEAM_COLUMNS)
    .maybeSingle();
  if (error) return dbErrorResponse(error, "Team update");
  if (!data) return jsonError(404, "not_found", "Team not found");
  return NextResponse.json({ team: toSetupTeam(data) });
}

export async function DELETE(_request: Request, { params }: IdParams) {
  const guard = await crmGuard("setup_roles", "delete");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "not_found", "Team not found");

  // Members keep their account; crm_users.team_id is set to null by the FK.
  const { data, error } = await guard.supabase.from("crm_teams").delete().eq("id", id).select("id");
  if (error) return dbErrorResponse(error, "Team delete");
  if (!data?.length) return jsonError(404, "not_found", "Team not found");
  return NextResponse.json({ ok: true });
}
