import { NextResponse } from "next/server";
import { createDefaultConfig } from "@/lib/crm/industry-news/config";
import { ingestNews, loadStoredConfig, saveStoredConfig } from "@/lib/crm/industry-news/server";
import { dbErrorResponse } from "@/lib/crm/setup/api.server";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const guard = await crmGuard("industry_news", "edit");
  if (guard instanceof NextResponse) return guard;
  try {
    const existing = await loadStoredConfig(guard.supabase, guard.user.id);
    const defaults = createDefaultConfig();
    const stored =
      existing ?? (await saveStoredConfig(guard.supabase, guard.user.id, defaults.name, defaults));
    const result = await ingestNews(guard.supabase, guard.user.id, stored);
    return NextResponse.json(result);
  } catch (error) {
    return dbErrorResponse(error as { code?: string; message?: string }, "Industry news ingest");
  }
}
