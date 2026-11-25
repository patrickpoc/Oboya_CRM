import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCasdoorConfig, isCasdoorConfigured } from "@/lib/auth/casdoor/config";
import { createOAuthState } from "@/lib/auth/casdoor/pkce";
import { createClient } from "@/lib/supabase/server";

/**
 * RP-initiated logout: first drop the Supabase session, then end the Casdoor
 * browser session through its OIDC end-session endpoint. Casdoor only
 * redirects to URLs registered in the application's Redirect URLs.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const secure = url.protocol === "https:";

  const supabase = await createClient();
  await supabase.auth.signOut();

  const cookieStore = await cookies();
  const idToken = cookieStore.get("casdoor_id_token")?.value;

  let target = `${origin}/login?signed_out=1`;
  if (isCasdoorConfigured()) {
    const config = getCasdoorConfig(origin);
    const logoutUrl = new URL(config.logoutUrl);
    if (idToken) logoutUrl.searchParams.set("id_token_hint", idToken);
    else logoutUrl.searchParams.set("client_id", config.clientId);
    logoutUrl.searchParams.set("post_logout_redirect_uri", config.postLogoutUri);
    logoutUrl.searchParams.set("state", createOAuthState());
    target = logoutUrl.toString();
  }

  const response = NextResponse.redirect(target);
  response.cookies.set("casdoor_id_token", "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
  });
  // The post-logout URI must be query-free for Casdoor's Redirect URL check.
  // A short-lived first-party cookie lets /login still show the signed-out notice.
  response.cookies.set("casdoor_signed_out", "1", {
    httpOnly: false,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 5 * 60,
  });
  return response;
}
