import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { parseListQuery } from "@/lib/crm/objects/query";
import { errorResponse, guardObject } from "@/lib/crm/objects/route-helpers";
import { exportCsv } from "@/lib/crm/repositories/object-repository";

type Ctx = { params: Promise<{ object: string }> };

/** GET /api/crm/objects/:object/export — same filters as the list, ≤ 5000 rows. */
export async function GET(request: Request, { params }: Ctx) {
  const ctx = await guardObject((await params).object, "export");
  if (ctx instanceof NextResponse) return ctx;
  const query = parseListQuery(ctx.config, new URL(request.url).searchParams);
  try {
    const t = await getTranslations();
    const { csv } = await exportCsv(
      ctx.guard.supabase,
      ctx.config,
      query,
      { userId: ctx.guard.user.id },
      (key) => t(key)
    );
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${ctx.config.basePath.slice(1)}-${date}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error, "export");
  }
}
