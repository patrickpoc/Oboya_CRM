import { NextResponse } from "next/server";
import type { RunResponse } from "@/lib/crm/automation/api-contract";
import { runAutomation } from "@/lib/crm/server/admin-only/automation-run";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { dbErrorResponse, jsonError } from "@/lib/crm/setup/api.server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** "Run now": automation.edit, 5 runs per 5 minutes per user. */
export async function POST() {
  const guard = await crmGuard("automation", "edit");
  if (guard instanceof NextResponse) return guard;

  const { data: allowed, error: limitError } = await guard.supabase.rpc("crm_rate_limit_hit", {
    p_bucket: "automation.run",
    p_max: 5,
    p_window_seconds: 300,
  });
  if (limitError) return dbErrorResponse(limitError, "Automation run rate limit");
  if (allowed !== true) return jsonError(429, "rate_limited", "Too many requests");

  try {
    const run: RunResponse = { run: await runAutomation({ trigger: "manual", actorId: guard.user.id }) };
    return NextResponse.json(run);
  } catch (error) {
    return dbErrorResponse(error as { code?: string; message?: string }, "Automation run");
  }
}
