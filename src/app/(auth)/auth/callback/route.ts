import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  RECOVERY_COOKIE,
  RECOVERY_MAX_AGE_SECONDS,
  isRecoveryAccessToken,
} from "@/lib/supabase/recovery";
import { safeNext } from "@/lib/supabase/safe-next";

/** Exchanges the PKCE code from Supabase emails (password recovery) for a session. */
export async function GET(request: Request) {
  const { searchParams, origin, protocol } = new URL(request.url);
  const code = searchParams.get("code");
  const wantsReset = searchParams.get("next") === "/reset-password";

  if (code && isSupabaseConfigured()) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error && data.session) {
      // /reset-password is reachable only with a recovery session, marked here.
      if (wantsReset && isRecoveryAccessToken(data.session.access_token)) {
        const response = NextResponse.redirect(`${origin}/reset-password`);
        response.cookies.set(RECOVERY_COOKIE, data.session.user.id, {
          httpOnly: true,
          sameSite: "lax",
          secure: protocol === "https:",
          path: "/",
          maxAge: RECOVERY_MAX_AGE_SECONDS,
        });
        return response;
      }
      return NextResponse.redirect(`${origin}${safeNext(searchParams.get("next"))}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
