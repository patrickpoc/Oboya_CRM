import { NextResponse } from "next/server";
import { newsQuerySchema } from "@/lib/crm/industry-news/schemas";
import { bootstrapIndustryNews } from "@/lib/crm/industry-news/server";
import { dbErrorResponse } from "@/lib/crm/setup/api.server";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";

export const dynamic = "force-dynamic";

/** One request for config + first news page; the client caches it briefly. */
export async function GET(request: Request) {
  const guard = await crmGuard("industry_news", "view");
  if (guard instanceof NextResponse) return guard;
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsed = newsQuerySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", code: "invalid_input" }, { status: 400 });
  }
  try {
    return NextResponse.json(await bootstrapIndustryNews(guard.supabase, parsed.data));
  } catch (error) {
    return dbErrorResponse(error as { code?: string; message?: string }, "Industry news bootstrap");
  }
}
