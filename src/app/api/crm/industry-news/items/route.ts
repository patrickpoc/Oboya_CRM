import { NextResponse } from "next/server";
import { newsPageQuerySchema } from "@/lib/crm/industry-news/schemas";
import { listNewsItems } from "@/lib/crm/industry-news/server";
import { dbErrorResponse } from "@/lib/crm/setup/api.server";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await crmGuard("industry_news", "view");
  if (guard instanceof NextResponse) return guard;
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const parsed = newsPageQuerySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", code: "invalid_input" }, { status: 400 });
  }
  try {
    // The page RPC reads config rules itself; RLS still limits rows to the
    // caller's visibility, so this is one DB call and no extra config read.
    return NextResponse.json(await listNewsItems(guard.supabase, parsed.data.configId, parsed.data));
  } catch (error) {
    return dbErrorResponse(error as { code?: string; message?: string }, "Industry news items read");
  }
}
