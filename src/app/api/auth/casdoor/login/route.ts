import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCasdoorConfig, isCasdoorConfigured } from "@/lib/auth/casdoor/config";
import {
  buildAuthorizeUrl,
  createCodeVerifier,
  createOAuthState,
  createPkceChallenge,
} from "@/lib/auth/casdoor/pkce";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { safeNext } from "@/lib/supabase/safe-next";

const COOKIE_MAX_AGE_SECONDS = 10 * 60;

function cookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  };
}

/**
 * Starts the OAuth 2.0 authorization-code flow with PKCE.
 * `intent=link` requires an active CRM session and binds the Casdoor identity
 * to that user instead of signing in as (or creating) another account.
 */
export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = requestUrl.origin;

  if (!isCasdoorConfigured()) {
    return NextResponse.redirect(`${origin}/login?error=unavailable`);
  }

  const linking = requestUrl.searchParams.get("intent") === "link";
  const next = safeNext(requestUrl.searchParams.get("next"));
  let linkUserId = "";
  if (linking) {
    const guard = await crmGuard(undefined, "view");
    if (guard instanceof NextResponse) {
      return NextResponse.redirect(`${origin}/login?next=${encodeURIComponent("/profile")}`);
    }
    linkUserId = guard.user.id;
  }

  const config = getCasdoorConfig(origin);
  const state = createOAuthState();
  const verifier = createCodeVerifier();
  const secure = requestUrl.protocol === "https:";

  const cookieStore = await cookies();
  cookieStore.set("casdoor_oauth_state", state, cookieOptions(secure));
  cookieStore.set("casdoor_code_verifier", verifier, cookieOptions(secure));
  cookieStore.set("casdoor_next", next, cookieOptions(secure));
  cookieStore.set("casdoor_intent", linking ? "link" : "login", cookieOptions(secure));
  if (linkUserId) cookieStore.set("casdoor_link_user", linkUserId, cookieOptions(secure));

  return NextResponse.redirect(
    buildAuthorizeUrl(config, { state, codeChallenge: createPkceChallenge(verifier) })
  );
}
