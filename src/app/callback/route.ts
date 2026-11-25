import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCasdoorConfig, isCasdoorConfigured } from "@/lib/auth/casdoor/config";
import { safeEqual } from "@/lib/auth/casdoor/pkce";
import { fetchCasdoorProfile, type CasdoorProfile } from "@/lib/auth/casdoor/profile";
import {
  CasdoorLinkError,
  provisionCasdoorSession,
  requestCasdoorLink,
} from "@/lib/crm/server/admin-only/casdoor-session";
import type { CasdoorPolicyCode } from "@/lib/auth/casdoor/policy";
import { safeNext } from "@/lib/supabase/safe-next";
import { createClient } from "@/lib/supabase/server";

const OAUTH_COOKIES = [
  "casdoor_oauth_state",
  "casdoor_code_verifier",
  "casdoor_next",
  "casdoor_intent",
  "casdoor_link_user",
] as const;
const ID_TOKEN_COOKIE = "casdoor_id_token";

const POLICY_ERRORS: Record<CasdoorPolicyCode, string> = {
  email_domain: "domain_not_allowed",
  account_type: "account_type_not_allowed",
  organization: "organization_not_allowed",
};

type TokenResponse = {
  access_token?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
};

function clearFlowCookies(response: NextResponse, secure: boolean) {
  for (const name of OAUTH_COOKIES) {
    response.cookies.set(name, "", {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 0,
    });
  }
  return response;
}

async function exchangeCode(
  tokenUrl: string,
  params: {
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    codeVerifier: string;
  }
): Promise<TokenResponse> {
  const fields = {
    grant_type: "authorization_code",
    client_id: params.clientId,
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  };
  let response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...fields, client_secret: params.clientSecret }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    // Casdoor supports both client_secret_post and client_secret_basic.
    const basic = Buffer.from(`${params.clientId}:${params.clientSecret}`).toString("base64");
    response = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams(fields),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  }
  if (!response.ok) throw new Error(`Casdoor token exchange failed (${response.status})`);
  return (await response.json()) as TokenResponse;
}

/**
 * Casdoor redirects here with an authorization code. In login mode we map the
 * OIDC profile to the existing Supabase user (or create one) and open a normal
 * Supabase session; in link mode we attach the identity to the signed-in user
 * without creating or switching accounts.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const secure = url.protocol === "https:";

  const fail = (reason: string, page: "login" | "profile" = "login") =>
    clearFlowCookies(
      NextResponse.redirect(`${origin}/${page}?error=${encodeURIComponent(reason)}`),
      secure
    );

  if (!isCasdoorConfigured()) return fail("unavailable");

  if (url.searchParams.get("error")) return fail("casdoor");
  const code = url.searchParams.get("code");
  if (!code) return fail("auth");

  // RFC 9207: Casdoor appends `iss`; reject a response from a different issuer.
  const issuerParam = url.searchParams.get("iss");
  const config = getCasdoorConfig(origin);
  if (issuerParam && issuerParam.replace(/\/+$/, "") !== config.issuer) return fail("casdoor");

  const cookieStore = await cookies();
  const state = cookieStore.get("casdoor_oauth_state")?.value;
  const verifier = cookieStore.get("casdoor_code_verifier")?.value;
  const next = cookieStore.get("casdoor_next")?.value ?? null;
  const linking = cookieStore.get("casdoor_intent")?.value === "link";
  const linkUserId = cookieStore.get("casdoor_link_user")?.value;
  if (!safeEqual(state, url.searchParams.get("state")) || !verifier) {
    return fail("oauth_state", linking ? "profile" : "login");
  }
  if (linking && !linkUserId) return fail("oauth_session", "profile");

  let tokens: TokenResponse;
  try {
    tokens = await exchangeCode(config.tokenUrl, {
      code,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
      codeVerifier: verifier,
    });
    if (!tokens.access_token) {
      throw new Error(tokens.error_description || tokens.error || "no access token");
    }
  } catch (error) {
    console.error("Casdoor token exchange failed:", error);
    return fail("oauth_token", linking ? "profile" : "login");
  }

  let profile: CasdoorProfile;
  try {
    profile = await fetchCasdoorProfile(config, tokens.access_token, tokens.id_token);
  } catch (error) {
    console.error("Casdoor profile fetch failed:", error);
    return fail("oauth_profile", linking ? "profile" : "login");
  }

  const supabase = await createClient();

  if (linking) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || user.id !== linkUserId) return fail("oauth_session", "profile");

    try {
      await requestCasdoorLink(profile, linkUserId);
    } catch (error) {
      if (error instanceof CasdoorLinkError && error.code === "pending") {
        const pendingResponse = clearFlowCookies(
          NextResponse.redirect(`${origin}/profile?link_pending=1`),
          secure
        );
        if (tokens.id_token) {
          pendingResponse.cookies.set(ID_TOKEN_COOKIE, tokens.id_token, {
            httpOnly: true,
            sameSite: "lax",
            secure,
            path: "/",
            maxAge: 60 * 60 * 24,
          });
        }
        return pendingResponse;
      }
      if (error instanceof CasdoorLinkError) {
        if (error.code === "policy" && error.policyCode) {
          return fail(POLICY_ERRORS[error.policyCode], "profile");
        }
        if (error.code !== "failed") return fail(error.code, "profile");
      }
      console.error("Casdoor link failed:", error);
      return fail("unavailable", "profile");
    }

    const linkedResponse = clearFlowCookies(
      NextResponse.redirect(`${origin}/profile?linked=1`),
      secure
    );
    if (tokens.id_token) {
      linkedResponse.cookies.set(ID_TOKEN_COOKIE, tokens.id_token, {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        maxAge: 60 * 60 * 24,
      });
    }
    return linkedResponse;
  }

  let seed;
  try {
    seed = await provisionCasdoorSession(profile, Date.now());
  } catch (error) {
    // A rejected or unapproved Casdoor identity must never keep a Supabase
    // session, even if somebody was signed in before starting the flow.
    await supabase.auth.signOut();
    if (error instanceof CasdoorLinkError) {
      if (error.code === "policy" && error.policyCode) {
        return fail(POLICY_ERRORS[error.policyCode]);
      }
      if (error.code === "pending") return fail("pending_approval");
      if (error.code === "rejected") return fail("access_rejected");
      if (error.code !== "failed") return fail("casdoor_link");
    }
    console.error("Casdoor session provisioning failed:", error);
    return fail("unavailable");
  }

  // Never carry a previous CRM identity into the newly created session.
  await supabase.auth.signOut();
  const { error: verifyError } = await supabase.auth.verifyOtp({
    email: seed.email,
    token: seed.otp,
    type: "email",
  });
  if (verifyError) {
    console.error("Supabase session exchange failed:", verifyError.message);
    return fail("casdoor");
  }

  const response = clearFlowCookies(
    NextResponse.redirect(`${origin}${safeNext(next)}`),
    secure
  );
  // Kept for RP-initiated logout (id_token_hint), never used for authorization.
  if (tokens.id_token) {
    response.cookies.set(ID_TOKEN_COOKIE, tokens.id_token, {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: 60 * 60 * 24,
    });
  }
  return response;
}
