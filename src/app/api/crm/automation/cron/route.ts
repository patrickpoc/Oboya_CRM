import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/crm/industry-news/cron-auth";
import { runAutomation } from "@/lib/crm/server/admin-only/automation-run";
import { dbErrorResponse } from "@/lib/crm/setup/api.server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Daily fallback for pg_cron. Vercel Cron calls GET with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "Cron not configured", code: "not_configured" }, { status: 503 });
  }
  if (!isCronAuthorized(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 });
  }
  try {
    const run = await runAutomation({ trigger: "vercel_cron" });
    return NextResponse.json({ run }, { status: run.status === "failed" ? 502 : 200 });
  } catch (error) {
    return dbErrorResponse(error as { code?: string; message?: string }, "Automation cron run");
  }
}

export { GET as POST };
