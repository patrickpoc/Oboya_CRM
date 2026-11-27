import { NextResponse } from "next/server";
import type { RunsResponse } from "@/lib/crm/automation/api-contract";
import { runsQuerySchema } from "@/lib/crm/automation/schemas";
import { AUTOMATION_RUN_COLUMNS, fromDbRow, type AutomationRun } from "@/lib/crm/automation/types";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { dbErrorResponse, jsonError } from "@/lib/crm/setup/api.server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await crmGuard("automation", "view");
  if (guard instanceof NextResponse) return guard;
  const q = runsQuerySchema.safeParse({ limit: new URL(request.url).searchParams.get("limit") ?? undefined });
  if (!q.success) return jsonError(400, "invalid_input", "Invalid filters");
  const { data, error } = await guard.supabase
    .from("crm_automation_runs")
    .select(AUTOMATION_RUN_COLUMNS)
    .order("started_at", { ascending: false })
    .limit(q.data.limit);
  if (error) return dbErrorResponse(error, "Automation runs read");
  const res: RunsResponse = {
    runs: (data ?? []).map((r) => fromDbRow<AutomationRun>(r as unknown as Record<string, unknown>)),
  };
  return NextResponse.json(res);
}
