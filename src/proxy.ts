import { type NextRequest, NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  // Without Supabase every page fails closed in requireCrmAuth(); let the
  // auth pages render their "unavailable" notice.
  if (!isSupabaseConfigured()) return NextResponse.next();
  return updateSession(request);
}

/**
 * `/api` is excluded: route handlers enforce auth themselves with crmGuard()
 * (and /api/inbound with its HMAC signature), as in the reference app.
 */
export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
