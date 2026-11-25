import "server-only";

import { cache } from "react";
import { NextResponse } from "next/server";
import { redirect } from "next/navigation";
import type {
  CrmAction,
  CrmModule,
  CrmUser,
  PermissionOverrides,
  ResolvedPermissions,
  VisibilityScope,
} from "@/lib/crm/types";
import type { AccessMatrix } from "@/lib/crm/permissions/access-types";
import { canAccessUser, resolvePermissions } from "@/lib/crm/permissions/access-resolve";
import { getBuiltinRoleLabel } from "@/lib/crm/permissions/defaults";
import { loadAccessMatrix } from "@/lib/crm/server/access-control.server";
import { isLocale, defaultLocale } from "@/i18n/routing";
import { isCasdoorSessionRevoked } from "@/lib/auth/casdoor/revocation";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { mustChangePassword } from "@/lib/supabase/proxy";
import { createClient, type CrmSupabaseClient } from "@/lib/supabase/server";

export type CrmAuthOk = {
  ok: true;
  user: CrmUser;
  supabase: CrmSupabaseClient;
  matrix: AccessMatrix;
};
export type CrmAuthFailReason =
  | "unauthenticated"
  | "inactive"
  | "mfa"
  | "password_change"
  | "forbidden"
  | "unavailable";
export type CrmAuthFail = {
  ok: false;
  status: 401 | 403 | 503;
  reason: CrmAuthFailReason;
  error: string;
};
export type CrmAuthResult = CrmAuthOk | CrmAuthFail;

const FAIL: Record<CrmAuthFailReason, CrmAuthFail> = {
  unauthenticated: { ok: false, status: 401, reason: "unauthenticated", error: "Unauthorized" },
  inactive: { ok: false, status: 401, reason: "inactive", error: "Unauthorized" },
  mfa: { ok: false, status: 403, reason: "mfa", error: "Multi-factor authentication required" },
  password_change: {
    ok: false,
    status: 403,
    reason: "password_change",
    error: "Password change required",
  },
  forbidden: { ok: false, status: 403, reason: "forbidden", error: "Forbidden" },
  unavailable: { ok: false, status: 503, reason: "unavailable", error: "Service unavailable" },
};

type ProfileRow = {
  id: string;
  email: string;
  full_name: string;
  role: string;
  team_id: string | null;
  status: string;
  locale: string;
  permission_overrides: unknown;
  crm_roles: { label: string; visibility_scope: string; can_write: boolean; active: boolean } | null;
};

const PROFILE_COLUMNS =
  "id, email, full_name, role, team_id, status, locale, permission_overrides, crm_roles(label, visibility_scope, can_write, active)";

function toOverrides(value: unknown): PermissionOverrides {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as PermissionOverrides)
    : {};
}

function toScope(value: string | undefined): VisibilityScope {
  return value === "all" || value === "team" ? value : "own";
}

export function profileToCrmUser(
  row: ProfileRow,
  authEmail: string,
  needsPasswordChange: boolean
): CrmUser {
  return {
    id: row.id,
    email: authEmail || row.email,
    fullName: row.full_name,
    role: row.role,
    roleLabel: row.crm_roles?.label ?? getBuiltinRoleLabel(row.role),
    visibilityScope: toScope(row.crm_roles?.visibility_scope),
    canWrite: row.crm_roles?.can_write === true,
    teamId: row.team_id,
    locale: isLocale(row.locale) ? row.locale : defaultLocale,
    permissionOverrides: toOverrides(row.permission_overrides),
    mustChangePassword: needsPasswordChange,
  };
}

/** Session + profile + access matrix, deduplicated within one request tree. */
const resolveCrmSession = cache(async (): Promise<CrmAuthResult> => {
  if (!isSupabaseConfigured()) return FAIL.unavailable;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return FAIL.unauthenticated;
  if (await isCasdoorSessionRevoked(supabase, user)) return FAIL.unauthenticated;

  const { data: profile, error } = await supabase
    .from("crm_users")
    .select(PROFILE_COLUMNS)
    .eq("id", user.id)
    .maybeSingle<ProfileRow>();
  if (error) {
    console.error("crm_users read failed:", error.message);
    return FAIL.unavailable;
  }
  // No profile, a disabled user or a deactivated role: treated as signed out.
  if (!profile || profile.status !== "active" || profile.crm_roles?.active === false) {
    return FAIL.inactive;
  }

  if (process.env.CRM_REQUIRE_MFA === "true") {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const enrolled = aal?.nextLevel === "aal2";
    if (aal?.currentLevel !== "aal2" && (enrolled || profile.role === "super_admin")) {
      return FAIL.mfa;
    }
  }

  const crmUser = profileToCrmUser(profile, user.email ?? "", mustChangePassword(user));

  let matrix: AccessMatrix;
  try {
    matrix = await loadAccessMatrix(supabase);
  } catch (loadError) {
    console.error("Access control unavailable:", loadError);
    // Super Admin has full access by code and can still repair the matrix.
    if (crmUser.role !== "super_admin") return FAIL.unavailable;
    matrix = {};
  }

  return { ok: true, user: crmUser, supabase, matrix };
});

/** Non-throwing check, optionally for one module/action. */
export async function getCrmAuth(input?: {
  module: CrmModule;
  action?: CrmAction;
}): Promise<CrmAuthResult> {
  const session = await resolveCrmSession();
  if (!session.ok || !input) return session;
  if (!canAccessUser(session.user, input.module, input.action ?? "view", session.matrix)) {
    return FAIL.forbidden;
  }
  return session;
}

export type CrmPageAuth = CrmAuthOk & {
  can: (module: CrmModule, action?: CrmAction) => boolean;
  permissions: () => ResolvedPermissions;
};

/**
 * For pages and layouts: returns the session or redirects. Module checks are
 * done by the page with `can()` so it can render an access-denied state.
 */
export async function requireCrmAuth(): Promise<CrmPageAuth> {
  const session = await resolveCrmSession();
  if (!session.ok) {
    if (session.reason === "unauthenticated") redirect("/login");
    if (session.reason === "inactive") redirect("/login?error=inactive");
    // AAL2 required: enroll or challenge on /mfa (no sign-out, no lockout).
    if (session.reason === "mfa") redirect("/mfa");
    redirect("/login?error=unavailable");
  }
  if (session.user.mustChangePassword) redirect("/change-password");
  return {
    ...session,
    can: (module, action = "view") =>
      canAccessUser(session.user, module, action, session.matrix),
    permissions: () => resolvePermissions(session.user, session.matrix),
  };
}

export type CrmGuardOk = { ok: true; user: CrmUser; supabase: CrmSupabaseClient; matrix: AccessMatrix };
export type CrmGuardResult = CrmGuardOk | NextResponse;
export type CrmGuardOptions = {
  /** Only for /api/crm/me and /api/crm/me/change-password. */
  allowPasswordChangePending?: boolean;
};

function failResponse(fail: CrmAuthFail) {
  return NextResponse.json({ error: fail.error, code: fail.reason }, { status: fail.status });
}

/**
 * For /api/crm/** route handlers. Without a module it only requires an active
 * session (e.g. /api/crm/me). Usage:
 *   const guard = await crmGuard("leads", "edit");
 *   if (guard instanceof NextResponse) return guard;
 * A user with a pending forced password change gets 403 unless the route opts in.
 */
export async function crmGuard(
  module?: CrmModule,
  action: CrmAction = "view",
  options: CrmGuardOptions = {}
): Promise<CrmGuardResult> {
  const session = await resolveCrmSession();
  if (!session.ok) return failResponse(session);
  if (session.user.mustChangePassword && !options.allowPasswordChangePending) {
    return failResponse(FAIL.password_change);
  }
  if (module && !canAccessUser(session.user, module, action, session.matrix)) {
    return failResponse(FAIL.forbidden);
  }
  return { ok: true, user: session.user, supabase: session.supabase, matrix: session.matrix };
}
