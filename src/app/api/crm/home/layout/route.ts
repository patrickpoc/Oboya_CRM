import { NextResponse } from "next/server";
import { z } from "zod";
import type { HomeLayoutResponse } from "@/lib/crm/reports/api-contract";
import { HOME_LAYOUT_SCOPES, HomeLayoutInputSchema, type HomeLayoutScope } from "@/lib/crm/reports/definition";
import {
  deleteHomeLayout,
  getHomeLayout,
  publishActor,
  resolveHome,
  saveHomeLayout,
  type Viewer,
} from "@/lib/crm/reports/repository";
import { failure, forbidden, invalidInput, viewerOf } from "@/lib/crm/reports/route";
import type { CrmSupabaseClient } from "@/lib/supabase/server";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { parseBody } from "@/lib/crm/setup/api.server";

export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  scope: z.enum(HOME_LAYOUT_SCOPES).optional(),
  teamId: z.guid().optional(),
});

/** Scopes the viewer may write: user always; team for admins and team managers; default for admins. */
async function writableScopes(client: CrmSupabaseClient, v: Viewer): Promise<HomeLayoutScope[]> {
  const actor = await publishActor(client, v);
  if (actor.isAdmin) return ["user", "team", "default"];
  return v.teamId && actor.managedTeamIds.includes(v.teamId) ? ["user", "team"] : ["user"];
}

/** Team layouts: admins any team, managers only the teams they manage. */
async function mayWrite(
  client: CrmSupabaseClient,
  v: Viewer,
  scope: HomeLayoutScope,
  teamId: string | undefined
): Promise<boolean> {
  if (scope === "user") return true;
  const actor = await publishActor(client, v);
  if (scope === "default") return actor.isAdmin;
  const target = teamId ?? v.teamId;
  return !!target && (actor.isAdmin || actor.managedTeamIds.includes(target));
}

/** GET: the resolved layout (user, team, default), or the one saved at `?scope=`. */
export async function GET(request: Request) {
  const guard = await crmGuard("home", "view");
  if (guard instanceof NextResponse) return guard;
  const query = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return invalidInput(query.error);
  const v = viewerOf(guard);
  try {
    const { scope, teamId } = query.data;
    const canWrite = await writableScopes(guard.supabase, v);
    const layout = scope
      ? await getHomeLayout(guard.supabase, v, scope, teamId).then((widgets) => ({
          source: widgets ? scope : null,
          widgets,
        }))
      : await resolveHome(guard.supabase, v);
    return NextResponse.json({ ...layout, canWrite } satisfies HomeLayoutResponse);
  } catch (error) {
    return failure(error, "Get home layout");
  }
}

/** PUT `?scope=`: saves the layout at that scope. */
export async function PUT(request: Request) {
  const guard = await crmGuard("home", "view");
  if (guard instanceof NextResponse) return guard;
  const query = QuerySchema.required({ scope: true }).safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  );
  if (!query.success) return invalidInput(query.error);
  const body = await parseBody(request, HomeLayoutInputSchema);
  if (body instanceof NextResponse) return body;
  const v = viewerOf(guard);
  const { scope, teamId } = query.data;
  try {
    if (!(await mayWrite(guard.supabase, v, scope, teamId))) return forbidden();
    await saveHomeLayout(guard.supabase, v, scope, teamId, body.data.widgets);
    const canWrite = await writableScopes(guard.supabase, v);
    return NextResponse.json({ source: scope, widgets: body.data.widgets, canWrite } satisfies HomeLayoutResponse);
  } catch (error) {
    return failure(error, "Save home layout");
  }
}

/** DELETE `?scope=user` (default): removes that layout, e.g. "reset to team default". */
export async function DELETE(request: Request) {
  const guard = await crmGuard("home", "view");
  if (guard instanceof NextResponse) return guard;
  const query = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return invalidInput(query.error);
  const v = viewerOf(guard);
  const scope = query.data.scope ?? "user";
  try {
    if (!(await mayWrite(guard.supabase, v, scope, query.data.teamId))) return forbidden();
    await deleteHomeLayout(guard.supabase, v, scope, query.data.teamId);
    const canWrite = await writableScopes(guard.supabase, v);
    return NextResponse.json({ ...(await resolveHome(guard.supabase, v)), canWrite } satisfies HomeLayoutResponse);
  } catch (error) {
    return failure(error, "Reset home layout");
  }
}
