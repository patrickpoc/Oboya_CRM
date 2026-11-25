import { createRemoteJWKSet, jwtVerify } from "jose";
import { NextResponse } from "next/server";
import { getCasdoorConfig, isCasdoorConfigured } from "@/lib/auth/casdoor/config";
import { markCasdoorSessionLoggedOut } from "@/lib/crm/server/admin-only/casdoor-session";

const BACKCHANNEL_EVENT = "http://schemas.openid.net/event/backchannel-logout";

/**
 * OIDC Back-Channel Logout 1.0 receiver. Casdoor POSTs a signed `logout_token`
 * here; after verification we record the logout time, and any Supabase session
 * opened before it is rejected by isCasdoorSessionRevoked().
 *
 * Register this URL as "Backchannel logout URL" on the Casdoor application:
 *   https://oboyacrm.vercel.app/api/auth/casdoor/backchannel-logout
 */
export async function POST(request: Request) {
  if (!isCasdoorConfigured()) return new NextResponse(null, { status: 503 });

  let logoutToken: string | null = null;
  try {
    const form = await request.formData();
    const value = form.get("logout_token");
    logoutToken = typeof value === "string" ? value : null;
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (!logoutToken) return new NextResponse(null, { status: 400 });

  const config = getCasdoorConfig();
  try {
    const { payload } = await jwtVerify(
      logoutToken,
      createRemoteJWKSet(new URL(config.jwksUrl), { cooldownDuration: 30_000 }),
      { issuer: config.issuer, audience: config.clientId, algorithms: ["RS256", "RS512"] }
    );

    const events = payload.events as Record<string, unknown> | undefined;
    if (!events || !(BACKCHANNEL_EVENT in events)) {
      throw new Error("Token is not a back-channel logout token");
    }
    // A logout token must not carry a nonce (that distinguishes it from an ID token).
    if (payload.nonce) throw new Error("Unexpected nonce in logout token");
    if (!payload.sub) throw new Error("Logout token is missing sub");

    await markCasdoorSessionLoggedOut(payload.sub);
  } catch (error) {
    console.error("Casdoor back-channel logout rejected:", error);
    return new NextResponse(null, { status: 400 });
  }

  return new NextResponse(null, { status: 200, headers: { "Cache-Control": "no-store" } });
}

/** Health probe for the Casdoor application configuration. */
export async function GET() {
  return NextResponse.json({ configured: isCasdoorConfigured() });
}
