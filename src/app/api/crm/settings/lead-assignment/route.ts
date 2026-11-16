import { NextResponse } from "next/server";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { dbErrorResponse, jsonError, parseBody } from "@/lib/crm/setup/api.server";
import { leadAssignmentSchema } from "@/lib/crm/setup/schemas";
import type { CrmSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** D3: crm_settings.inbound_assignment {mode} + inbound_default_owner (uuid string | null). */
async function load(supabase: CrmSupabaseClient) {
  const [settings, users] = await Promise.all([
    supabase.from("crm_settings").select("key, value").in("key", ["inbound_assignment", "inbound_default_owner"]),
    supabase
      .from("crm_users")
      .select("id, full_name, email, role, status, receives_inbound, crm_roles(label, can_write)")
      .order("full_name"),
  ]);
  if (settings.error || users.error) return { error: settings.error ?? users.error } as const;

  const byKey = new Map((settings.data ?? []).map((s) => [s.key, s.value as unknown]));
  const assignment = byKey.get("inbound_assignment") as { mode?: string } | null | undefined;
  const owner = byKey.get("inbound_default_owner");
  return {
    mode: assignment?.mode === "default_owner" ? "default_owner" : "round_robin",
    defaultOwnerId: typeof owner === "string" ? owner : null,
    users: (users.data ?? []).map((u) => {
      const role = (Array.isArray(u.crm_roles) ? u.crm_roles[0] : u.crm_roles) as
        | { label: string; can_write: boolean }
        | null;
      return {
        id: u.id,
        fullName: u.full_name || u.email,
        email: u.email,
        roleLabel: role?.label ?? u.role,
        canWrite: role?.can_write === true,
        status: u.status,
        receivesInbound: u.receives_inbound,
      };
    }),
  } as const;
}

export async function GET() {
  const guard = await crmGuard("setup_lead_assignment", "view");
  if (guard instanceof NextResponse) return guard;
  const result = await load(guard.supabase);
  if ("error" in result) return dbErrorResponse(result.error, "Lead assignment read");
  return NextResponse.json(result);
}

export async function PUT(request: Request) {
  const guard = await crmGuard("setup_lead_assignment", "edit");
  if (guard instanceof NextResponse) return guard;
  const body = await parseBody(request, leadAssignmentSchema);
  if (body instanceof NextResponse) return body;
  const { mode, defaultOwnerId } = body.data;

  if (defaultOwnerId) {
    const { data: owner } = await guard.supabase
      .from("crm_users")
      .select("status")
      .eq("id", defaultOwnerId)
      .maybeSingle();
    if (owner?.status !== "active") return jsonError(400, "invalid_owner", "Default owner must be an active user");
  }

  const { error } = await guard.supabase.from("crm_settings").upsert(
    [
      { key: "inbound_assignment", value: { mode }, updated_by: guard.user.id },
      { key: "inbound_default_owner", value: defaultOwnerId, updated_by: guard.user.id },
    ],
    { onConflict: "key" }
  );
  if (error) return dbErrorResponse(error, "Lead assignment save");

  const result = await load(guard.supabase);
  if ("error" in result) return dbErrorResponse(result.error, "Lead assignment read");
  return NextResponse.json(result);
}
