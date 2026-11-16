import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { DEFAULT_AFTER_LOGIN, safeNext } from "@/lib/supabase/safe-next";

/** Pages an anonymous visitor may open. */
const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password"];
/** Pages a signed-in user is sent away from (to the dashboard). */
const SIGNED_OUT_ONLY = ["/login", "/forgot-password"];
const CHANGE_PASSWORD = "/change-password";

function isAuthCallback(pathname: string) {
  return pathname === "/auth" || pathname.startsWith("/auth/");
}

/** Set by an admin (service role) on temporary passwords; users cannot edit app_metadata. */
export function mustChangePassword(user: { app_metadata?: Record<string, unknown> }) {
  return user.app_metadata?.must_change_password === true;
}

function redirectTo(request: NextRequest, pathname: string, search = "") {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = search;
  return NextResponse.redirect(url);
}

/**
 * Refreshes the Supabase session cookies and applies the page-level auth
 * redirects. Route handlers are not matched (see src/proxy.ts); they guard
 * themselves with crmGuard().
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, anonKey } = getSupabaseEnv();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // getUser() revalidates the JWT with Supabase Auth (getSession() would not).
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, searchParams } = request.nextUrl;
  const callback = isAuthCallback(pathname);

  if (!user) {
    if (callback || PUBLIC_PATHS.includes(pathname)) return response;
    const next = safeNext(`${pathname}${request.nextUrl.search}`);
    return redirectTo(request, "/login", `?next=${encodeURIComponent(next)}`);
  }

  if (callback) return response;

  const needsChange = mustChangePassword(user);
  // /mfa stays reachable: the password change API needs AAL2 when MFA is required.
  if (needsChange && ![CHANGE_PASSWORD, "/reset-password", "/mfa"].includes(pathname)) {
    // An error notice on /login (disabled account, MFA) must stay visible.
    if (!(pathname === "/login" && searchParams.has("error"))) {
      return redirectTo(request, CHANGE_PASSWORD);
    }
  }

  if (SIGNED_OUT_ONLY.includes(pathname) && !searchParams.has("error")) {
    return redirectTo(request, safeNext(searchParams.get("next")) || DEFAULT_AFTER_LOGIN);
  }

  return response;
}
