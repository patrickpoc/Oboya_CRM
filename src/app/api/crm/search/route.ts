import { NextResponse } from "next/server";
import { z } from "zod";
import { invalid } from "@/lib/crm/objects/route-helpers";
import { canAccessUser } from "@/lib/crm/permissions/access-resolve";
import { normalizeSearchQuery } from "@/lib/crm/search/query";
import { globalSearch } from "@/lib/crm/search/search";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";

const querySchema = z.object({
  q: z
    .string()
    .max(500)
    .transform((value, ctx) => {
      const q = normalizeSearchQuery(value);
      if (!q) {
        ctx.addIssue({ code: "custom", message: "too_short" });
        return z.NEVER;
      }
      return q;
    }),
});

/**
 * GET /api/crm/search?q= — top 5 per object (leads, accounts, contacts,
 * opportunities). Any active user; each object is skipped without `view`,
 * and RLS scopes the rows.
 */
export async function GET(request: Request) {
  const guard = await crmGuard();
  if (guard instanceof NextResponse) return guard;
  const parsed = querySchema.safeParse({ q: new URL(request.url).searchParams.get("q") ?? "" });
  if (!parsed.success) return invalid({ q: "too_short" });
  try {
    const groups = await globalSearch(guard.supabase, parsed.data.q, (module, action = "view") =>
      canAccessUser(guard.user, module, action, guard.matrix)
    );
    return NextResponse.json({ q: parsed.data.q, groups }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[crm search]", error);
    return NextResponse.json({ error: "Request failed", code: "unavailable" }, { status: 500 });
  }
}
