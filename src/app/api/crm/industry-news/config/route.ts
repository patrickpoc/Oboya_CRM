import { NextResponse } from "next/server";
import { industryNewsConfigSchema } from "@/lib/crm/industry-news/schemas";
import { loadStoredConfig, saveStoredConfig } from "@/lib/crm/industry-news/server";
import { createDefaultConfig } from "@/lib/crm/industry-news/config";
import { dbErrorResponse, parseBody } from "@/lib/crm/setup/api.server";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await crmGuard("industry_news", "view");
  if (guard instanceof NextResponse) return guard;
  try {
    const stored = await loadStoredConfig(guard.supabase, guard.user.id);
    return NextResponse.json({
      config: stored?.config ?? createDefaultConfig(),
      name: stored?.name ?? "Industry news",
      saved: Boolean(stored),
      updatedAt: stored?.updatedAt ?? null,
    });
  } catch (error) {
    return dbErrorResponse(error as { code?: string; message?: string }, "Industry news config read");
  }
}

export async function PUT(request: Request) {
  const guard = await crmGuard("industry_news", "edit");
  if (guard instanceof NextResponse) return guard;
  const body = await parseBody(request, industryNewsConfigSchema);
  if (body instanceof NextResponse) return body;
  try {
    const stored = await saveStoredConfig(guard.supabase, guard.user.id, body.data.name, body.data);
    return NextResponse.json({ config: stored.config, name: stored.name, saved: true, updatedAt: stored.updatedAt });
  } catch (error) {
    return dbErrorResponse(error as { code?: string; message?: string }, "Industry news config save");
  }
}
