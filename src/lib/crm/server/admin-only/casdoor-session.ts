import "server-only";

import { normalizeCountryCode, type CasdoorProfile } from "@/lib/auth/casdoor/profile";
import { evaluateCasdoorPolicy, type CasdoorPolicyCode } from "@/lib/auth/casdoor/policy";
import { createServiceClient } from "@/lib/supabase/admin";

export type CasdoorSessionSeed = {
  email: string;
  otp: string;
  userId: string;
};

export type CasdoorLinkErrorCode =
  | "conflict"
  | "already_linked"
  | "not_found"
  | "no_password"
  | "policy"
  | "pending"
  | "rejected"
  | "request_failed"
  | "failed";

export class CasdoorLinkError extends Error {
  constructor(
    public readonly code: CasdoorLinkErrorCode,
    message: string,
    public readonly policyCode: CasdoorPolicyCode | null = null
  ) {
    super(message);
  }
}

export type CasdoorAccessIntent = "login" | "link";
export type CasdoorRequestStatus = "pending" | "approved" | "rejected" | "revoked";

export type CasdoorAccessRequest = {
  id: string;
  sub: string;
  userId: string;
  email: string;
  displayName: string;
  title: string | null;
  country: string | null;
  countryCode: string | null;
  location: string | null;
  phone: string | null;
  region: string | null;
  company: string | null;
  avatar: string | null;
  casdoorType: string | null;
  casdoorTags: string[];
  casdoorRoles: string[];
  organization: string | null;
  intent: CasdoorAccessIntent;
  status: CasdoorRequestStatus;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
};

const USER_PAGE_SIZE = 200;
const MAX_USER_PAGES = 100;

const LINKED_METADATA_KEYS = [
  "casdoor_sub",
  "casdoor_email",
  "casdoor_display_name",
  "casdoor_title",
  "casdoor_country",
  "casdoor_country_code",
  "casdoor_location",
  "casdoor_phone",
  "casdoor_region",
  "casdoor_company",
  "casdoor_avatar",
  "casdoor_type",
  "casdoor_tags",
  "casdoor_roles",
  "casdoor_organization",
  "casdoor_linked_at",
  "casdoor_auth_at",
] as const;

const REQUEST_COLUMNS = [
  "id",
  "sub",
  "user_id",
  "email",
  "display_name",
  "title",
  "country",
  "country_code",
  "location",
  "phone",
  "region",
  "company",
  "avatar",
  "casdoor_type",
  "casdoor_tags",
  "casdoor_roles",
  "organization",
  "intent",
  "status",
  "review_note",
  "reviewed_by",
  "reviewed_at",
  "created_at",
].join(", ");

type RequestRow = {
  id: string;
  sub: string;
  user_id: string;
  email: string;
  display_name: string | null;
  title: string | null;
  country: string | null;
  country_code: string | null;
  location: string | null;
  phone: string | null;
  region: string | null;
  company: string | null;
  avatar: string | null;
  casdoor_type: string | null;
  casdoor_tags: string[] | null;
  casdoor_roles: string[] | null;
  organization: string | null;
  intent: string;
  status: string;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

function toAccessRequest(row: RequestRow): CasdoorAccessRequest {
  return {
    id: row.id,
    sub: row.sub,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name ?? row.email,
    title: row.title,
    country: row.country,
    countryCode: row.country_code,
    location: row.location,
    phone: row.phone,
    region: row.region,
    company: row.company,
    avatar: row.avatar,
    casdoorType: row.casdoor_type,
    casdoorTags: row.casdoor_tags ?? [],
    casdoorRoles: row.casdoor_roles ?? [],
    organization: row.organization,
    intent: row.intent === "link" ? "link" : "login",
    status:
      row.status === "approved" || row.status === "rejected" || row.status === "revoked"
        ? row.status
        : "pending",
    reviewNote: row.review_note,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
  };
}

function profileFromRequest(request: CasdoorAccessRequest): CasdoorProfile {
  return {
    sub: request.sub,
    email: request.email,
    displayName: request.displayName,
    avatar: request.avatar,
    title: request.title,
    country: request.country,
    countryCode: request.countryCode,
    location: request.location,
    phone: request.phone,
    region: request.region,
    company: request.company,
    casdoorType: request.casdoorType,
    casdoorTags: request.casdoorTags,
    casdoorRoles: request.casdoorRoles,
    organization: request.organization,
  };
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function profileMetadata(profile: CasdoorProfile, authAt: number) {
  return {
    casdoor_sub: profile.sub,
    casdoor_email: profile.email,
    casdoor_display_name: profile.displayName,
    casdoor_title: profile.title,
    casdoor_country: profile.country,
    casdoor_country_code: profile.countryCode,
    casdoor_location: profile.location,
    casdoor_phone: profile.phone,
    casdoor_region: profile.region,
    casdoor_company: profile.company,
    casdoor_avatar: profile.avatar,
    casdoor_type: profile.casdoorType,
    casdoor_tags: profile.casdoorTags,
    casdoor_roles: profile.casdoorRoles,
    casdoor_organization: profile.organization,
    casdoor_linked_at: new Date(authAt).toISOString(),
    casdoor_auth_at: authAt,
  };
}

/** Only fill CRM profile fields the user has not already populated. */
function emptyProfilePatch(
  profile: { phone: string | null; countryCode: string | null; company: string | null },
  current: { phone: string | null; country_code: string | null; company: string | null }
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (!current.phone && profile.phone) patch.phone = profile.phone.slice(0, 40);
  if (!current.country_code && profile.countryCode) patch.country_code = profile.countryCode;
  if (!current.company && profile.company) patch.company = profile.company.slice(0, 200);
  return patch;
}

function assertPolicy(profile: CasdoorProfile) {
  const result = evaluateCasdoorPolicy(profile);
  if (!result.allowed) {
    throw new CasdoorLinkError("policy", result.message, result.code);
  }
}

function assertCanLink(
  profile: CasdoorProfile,
  userId: string,
  existingBinding: { user_id: string } | null,
  metadata: Record<string, unknown>
) {
  if (existingBinding && existingBinding.user_id !== userId) {
    throw new CasdoorLinkError(
      "conflict",
      "This Casdoor account is already linked to a different CRM user"
    );
  }
  const linkedSub = typeof metadata.casdoor_sub === "string" ? metadata.casdoor_sub : "";
  if (linkedSub && linkedSub !== profile.sub) {
    throw new CasdoorLinkError(
      "already_linked",
      "This CRM account is already linked to a different Casdoor account"
    );
  }
}

async function findUserByEmail(email: string) {
  const admin = createServiceClient();
  const normalized = normalizeEmail(email);

  for (let page = 1; page <= MAX_USER_PAGES; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: USER_PAGE_SIZE });
    if (error) throw new CasdoorLinkError("failed", `Supabase user lookup failed: ${error.message}`);

    const users = data?.users ?? [];
    const match = users.find((user) => normalizeEmail(user.email ?? "") === normalized);
    if (match) return match;
    if (users.length < USER_PAGE_SIZE) break;
  }
  return null;
}

async function findBinding(sub: string) {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from("crm_casdoor_sessions")
    .select("user_id")
    .eq("sub", sub)
    .maybeSingle<{ user_id: string }>();
  if (error) throw new CasdoorLinkError("failed", `Casdoor link lookup failed: ${error.message}`);
  return data;
}

async function findActiveRequest(sub: string, userId: string): Promise<CasdoorAccessRequest | null> {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from("crm_casdoor_access_requests")
    .select(REQUEST_COLUMNS)
    .eq("sub", sub)
    .eq("user_id", userId)
    .in("status", ["pending", "approved"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<RequestRow>();
  if (error) {
    throw new CasdoorLinkError("request_failed", `Casdoor access request lookup failed: ${error.message}`);
  }
  return data ? toAccessRequest(data) : null;
}

/** Latest request for a CRM user, used by /profile. */
export async function getCasdoorAccessRequest(userId: string): Promise<CasdoorAccessRequest | null> {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from("crm_casdoor_access_requests")
    .select(REQUEST_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<RequestRow>();
  if (error) {
    throw new CasdoorLinkError("request_failed", `Casdoor access request lookup failed: ${error.message}`);
  }
  return data ? toAccessRequest(data) : null;
}

async function createAccessRequest(
  profile: CasdoorProfile,
  userId: string,
  intent: CasdoorAccessIntent
): Promise<CasdoorAccessRequest> {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from("crm_casdoor_access_requests")
    .insert({
      sub: profile.sub,
      user_id: userId,
      email: normalizeEmail(profile.email),
      display_name: profile.displayName,
      title: profile.title,
      country: profile.country,
      country_code: profile.countryCode,
      location: profile.location,
      phone: profile.phone,
      region: profile.region,
      company: profile.company,
      avatar: profile.avatar,
      casdoor_type: profile.casdoorType,
      casdoor_tags: profile.casdoorTags,
      casdoor_roles: profile.casdoorRoles,
      organization: profile.organization,
      intent,
      status: "pending",
    })
    .select(REQUEST_COLUMNS)
    .single<RequestRow>();

  if (error) {
    // A concurrent sign-in may have created the pending row first.
    const existing = await findActiveRequest(profile.sub, userId);
    if (existing) return existing;
    throw new CasdoorLinkError("request_failed", `Casdoor access request failed: ${error.message}`);
  }
  return toAccessRequest(data);
}

/**
 * Always called before a Casdoor identity is used. It records a review request
 * and returns whether an admin has already approved this exact sub/user pair.
 */
export async function requestCasdoorAccess(
  profile: CasdoorProfile,
  intent: CasdoorAccessIntent,
  userId: string
): Promise<CasdoorAccessRequest> {
  assertPolicy(profile);

  const binding = await findBinding(profile.sub);
  if (binding && binding.user_id !== userId) {
    throw new CasdoorLinkError(
      "conflict",
      "This Casdoor account is already linked to a different CRM user"
    );
  }

  const existing = await findActiveRequest(profile.sub, userId);
  if (existing) return existing;
  return createAccessRequest(profile, userId, intent);
}

async function applyCasdoorIdentity(profile: CasdoorProfile, userId: string, authAt: number) {
  const admin = createServiceClient();
  const { data: user, error: userError } = await admin.auth.admin.getUserById(userId);
  if (userError || !user.user) {
    throw new CasdoorLinkError("not_found", "Current CRM user could not be loaded");
  }
  const metadata = {
    ...((user.user.user_metadata ?? {}) as Record<string, unknown>),
    ...profileMetadata(profile, authAt),
  };
  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
    user_metadata: metadata,
  });
  if (updateError) {
    throw new CasdoorLinkError("failed", `Supabase user update failed: ${updateError.message}`);
  }

  const { error: sessionError } = await admin.from("crm_casdoor_sessions").upsert(
    { sub: profile.sub, user_id: userId, logout_at: null, updated_at: new Date(authAt).toISOString() },
    { onConflict: "sub" }
  );
  if (sessionError) {
    throw new CasdoorLinkError("failed", `Casdoor session link failed: ${sessionError.message}`);
  }
}

/**
 * Login mode: resolve the Supabase user behind a Casdoor identity. A first
 * sign-in creates a disabled auth user and a pending review request, but does
 * NOT return an OTP, so the callback never opens a CRM session.
 */
export async function provisionCasdoorSession(
  profile: CasdoorProfile,
  authAt: number
): Promise<CasdoorSessionSeed> {
  assertPolicy(profile);

  const admin = createServiceClient();
  const email = normalizeEmail(profile.email);
  const binding = await findBinding(profile.sub);
  const match = await findUserByEmail(email);

  if (!match && binding) {
    throw new CasdoorLinkError(
      "conflict",
      "This Casdoor account belongs to another CRM user; sign in to that account or unlink it first"
    );
  }
  if (match) {
    assertCanLink(
      profile,
      match.id,
      binding,
      (match.user_metadata ?? {}) as Record<string, unknown>
    );
  }

  let userId = match?.id ?? "";
  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: profile.displayName, avatar_url: profile.avatar ?? "" },
    });
    if (error || !data.user) {
      throw new CasdoorLinkError(
        "failed",
        `Supabase user creation failed: ${error?.message ?? "unknown error"}`
      );
    }
    userId = data.user.id;
  }

  const request = await requestCasdoorAccess(profile, "login", userId);
  if (request.status !== "approved") {
    throw new CasdoorLinkError("pending", "Casdoor sign-in is waiting for CRM admin approval");
  }

  await applyCasdoorIdentity(profile, userId, authAt);

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  const emailOtp = link?.properties?.email_otp;
  if (linkError || !emailOtp) {
    throw new CasdoorLinkError(
      "failed",
      `Supabase OTP generation failed: ${linkError?.message ?? "no OTP returned"}`
    );
  }

  return { email, otp: emailOtp, userId };
}

/** Link mode initiated from /profile; binding is applied only after review. */
export async function requestCasdoorLink(profile: CasdoorProfile, userId: string): Promise<void> {
  const request = await requestCasdoorAccess(profile, "link", userId);
  if (request.status !== "approved") {
    throw new CasdoorLinkError("pending", "Casdoor link is waiting for CRM admin approval");
  }
  await applyCasdoorIdentity(profile, userId, Date.now());
}

/** Direct link, only used by the admin approval flow. */
export async function linkCasdoorAccount(profile: CasdoorProfile, userId: string): Promise<void> {
  assertPolicy(profile);
  await applyCasdoorIdentity(profile, userId, Date.now());
}

/** Admin decision: approve a pending request, assign a role and activate. */
export async function approveCasdoorRequest(input: {
  requestId: string;
  actorId: string;
  role: string;
  teamId: string | null;
  note: string | null;
}): Promise<CasdoorAccessRequest> {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from("crm_casdoor_access_requests")
    .select(REQUEST_COLUMNS)
    .eq("id", input.requestId)
    .eq("status", "pending")
    .maybeSingle<RequestRow>();
  if (error) {
    throw new CasdoorLinkError("request_failed", `Casdoor request lookup failed: ${error.message}`);
  }
  if (!data) throw new CasdoorLinkError("not_found", "Casdoor request not found or already reviewed");

  const request = toAccessRequest(data);
  const { data: role } = await admin
    .from("crm_roles")
    .select("id, active")
    .eq("id", input.role)
    .eq("active", true)
    .maybeSingle<{ id: string; active: boolean }>();
  if (!role) throw new CasdoorLinkError("failed", "Unknown or inactive role");

  const authAt = Date.now();
  // Login requests create a disabled user; approval activates it with the
  // reviewed role. Link requests only attach an identity to an existing user.
  const userUpdate: Record<string, unknown> =
    request.intent === "login"
      ? { role: input.role, team_id: input.teamId, status: "active" }
      : request.displayName
        ? { full_name: request.displayName }
        : {};
  const profile = profileFromRequest(request);
  const { data: current } = await admin
    .from("crm_users")
    .select("phone, country_code, company")
    .eq("id", request.userId)
    .maybeSingle<{ phone: string | null; country_code: string | null; company: string | null }>();
  Object.assign(
    userUpdate,
    emptyProfilePatch(profile, {
      phone: current?.phone ?? null,
      country_code: current?.country_code ?? null,
      company: current?.company ?? null,
    })
  );
  if (Object.keys(userUpdate).length > 0) {
    const { error: userError } = await admin
      .from("crm_users")
      .update(userUpdate)
      .eq("id", request.userId);
    if (userError) throw new CasdoorLinkError("failed", `User activation failed: ${userError.message}`);
  }

  await applyCasdoorIdentity(profile, request.userId, authAt);

  const { data: reviewed, error: reviewError } = await admin
    .from("crm_casdoor_access_requests")
    .update({
      status: "approved",
      review_note: input.note,
      reviewed_by: input.actorId,
      reviewed_at: new Date(authAt).toISOString(),
    })
    .eq("id", request.id)
    .select(REQUEST_COLUMNS)
    .single<RequestRow>();
  if (reviewError || !reviewed) {
    throw new CasdoorLinkError(
      "request_failed",
      `Casdoor approval failed: ${reviewError?.message ?? "no row returned"}`
    );
  }
  return toAccessRequest(reviewed);
}

/** Admin decision: deny a pending request. The user gets no CRM session. */
export async function rejectCasdoorRequest(input: {
  requestId: string;
  actorId: string;
  note: string | null;
}): Promise<CasdoorAccessRequest> {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from("crm_casdoor_access_requests")
    .update({
      status: "rejected",
      review_note: input.note,
      reviewed_by: input.actorId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", input.requestId)
    .eq("status", "pending")
    .select(REQUEST_COLUMNS)
    .maybeSingle<RequestRow>();
  if (error) {
    throw new CasdoorLinkError("request_failed", `Casdoor rejection failed: ${error.message}`);
  }
  if (!data) throw new CasdoorLinkError("not_found", "Casdoor request not found or already reviewed");
  return toAccessRequest(data);
}

export async function listCasdoorAccessRequests(): Promise<CasdoorAccessRequest[]> {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from("crm_casdoor_access_requests")
    .select(REQUEST_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(200)
    .returns<RequestRow[]>();
  if (error) {
    throw new CasdoorLinkError("request_failed", `Casdoor requests read failed: ${error.message}`);
  }
  return (data ?? []).map(toAccessRequest);
}

/** Returns the Casdoor binding for a CRM user, if any. */
export async function getCasdoorLink(
  userId: string
): Promise<{ sub: string; logoutAt: string | null } | null> {
  const admin = createServiceClient();
  const { data, error } = await admin
    .from("crm_casdoor_sessions")
    .select("sub, logout_at")
    .eq("user_id", userId)
    .maybeSingle<{ sub: string; logout_at: string | null }>();
  if (error) throw new CasdoorLinkError("failed", `Casdoor link lookup failed: ${error.message}`);
  return data ? { sub: data.sub, logoutAt: data.logout_at } : null;
}

/**
 * Removes the Casdoor link. Callers must first verify that the user has a
 * working password sign-in, otherwise they would be locked out.
 */
export async function unlinkCasdoorAccount(userId: string): Promise<void> {
  const admin = createServiceClient();
  const { data: user, error: userError } = await admin.auth.admin.getUserById(userId);
  if (userError || !user.user) {
    throw new CasdoorLinkError("not_found", "Current CRM user could not be loaded");
  }

  const current = (user.user.user_metadata ?? {}) as Record<string, unknown>;
  if (current.has_password !== true) {
    throw new CasdoorLinkError("no_password", "Set a password before unlinking Casdoor");
  }

  const metadata = { ...current };
  for (const key of LINKED_METADATA_KEYS) delete metadata[key];

  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
    user_metadata: metadata,
  });
  if (updateError) {
    throw new CasdoorLinkError("failed", `Supabase user update failed: ${updateError.message}`);
  }

  const { error: deleteError } = await admin
    .from("crm_casdoor_sessions")
    .delete()
    .eq("user_id", userId);
  if (deleteError) {
    throw new CasdoorLinkError("failed", `Casdoor link removal failed: ${deleteError.message}`);
  }

  // A re-link must go through admin review again.
  const { error: revokeError } = await admin
    .from("crm_casdoor_access_requests")
    .update({ status: "revoked", reviewed_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("status", "approved");
  if (revokeError) {
    throw new CasdoorLinkError("request_failed", `Casdoor link revocation failed: ${revokeError.message}`);
  }
}

/** Copies imported Casdoor fields into the editable CRM profile. */
export async function syncCasdoorProfile(
  userId: string
): Promise<{ fullName: string; title: string | null; phone: string | null; countryCode: string | null; company: string | null } | null> {
  const admin = createServiceClient();
  const { data: user, error: userError } = await admin.auth.admin.getUserById(userId);
  if (userError || !user.user) {
    throw new CasdoorLinkError("not_found", "Current CRM user could not be loaded");
  }

  const metadata = (user.user.user_metadata ?? {}) as Record<string, unknown>;
  const metaText = (key: string) => typeof metadata[key] === "string" ? (metadata[key] as string).trim() : "";
  const fullName = metaText("casdoor_display_name");
  const title = metaText("casdoor_title");
  if (!fullName) return null;

  const phone = metaText("casdoor_phone") || null;
  const countryCode =
    normalizeCountryCode(metaText("casdoor_country_code") || metaText("casdoor_country"));
  const company = metaText("casdoor_company") || null;
  const { data: current } = await admin
    .from("crm_users")
    .select("phone, country_code, company")
    .eq("id", userId)
    .maybeSingle<{ phone: string | null; country_code: string | null; company: string | null }>();

  const update: Record<string, unknown> = {
    full_name: fullName.slice(0, 120),
    title: title ? title.slice(0, 120) : null,
    ...emptyProfilePatch(
      { phone, countryCode, company },
      {
        phone: current?.phone ?? null,
        country_code: current?.country_code ?? null,
        company: current?.company ?? null,
      }
    ),
  };
  const { error } = await admin.from("crm_users").update(update).eq("id", userId);
  if (error) throw new CasdoorLinkError("failed", `Profile sync failed: ${error.message}`);

  return {
    fullName: fullName.slice(0, 120),
    title: title ? title.slice(0, 120) : null,
    phone: current?.phone || phone?.slice(0, 40) || null,
    countryCode: current?.country_code || countryCode || null,
    company: current?.company || company?.slice(0, 200) || null,
  };
}

/** Called by the OIDC back-channel logout receiver after token verification. */
export async function markCasdoorSessionLoggedOut(sub: string): Promise<void> {
  const admin = createServiceClient();
  const { error } = await admin
    .from("crm_casdoor_sessions")
    .update({ logout_at: new Date().toISOString() })
    .eq("sub", sub);
  if (error) throw new Error(`Casdoor logout record failed: ${error.message}`);
}
