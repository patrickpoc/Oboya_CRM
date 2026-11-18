import { NextResponse } from "next/server";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { dbErrorResponse } from "@/lib/crm/setup/api.server";

export const dynamic = "force-dynamic";

export type CaseReportResult = {
  total: number;
  open: number;
  resolved: number;
  breached: number;
  avgResolutionMinutes: number | null;
};

/** RLS-scoped aggregate for the cases list summary. */
export async function GET() {
  const guard = await crmGuard("cases", "view");
  if (guard instanceof NextResponse) return guard;
  try {
    const { data, error } = await guard.supabase.rpc("crm_case_report");
    if (error) throw error;
    return NextResponse.json(data as CaseReportResult);
  } catch (error) {
    return dbErrorResponse(error as { code?: string; message?: string }, "Case report");
  }
}
