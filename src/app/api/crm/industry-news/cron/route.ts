import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/crm/industry-news/cron-auth";
import { runIndustryNewsCron } from "@/lib/crm/server/admin-only/industry-news-cron";
import { dbErrorResponse } from "@/lib/crm/setup/api.server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Vercel Cron calls GET with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return NextResponse.json({ error: "Cron not configured", code: "not_configured" }, { status: 503 });
  }
  if (!isCronAuthorized(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized", code: "unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(await runIndustryNewsCron());
  } catch (error) {
    return dbErrorResponse(error as { code?: string; message?: string }, "Industry news cron ingest");
  }
}

export { GET as POST };
