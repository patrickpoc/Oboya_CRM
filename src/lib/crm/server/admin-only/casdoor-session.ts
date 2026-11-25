import "server-only";

import type { CasdoorProfile } from "@/lib/auth/casdoor/profile";
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
  | "failed";

export class CasdoorLinkError extends Error {
  constructor(
    public readonly code: CasdoorLinkErrorCode,
    message: string
  ) {
    super(message);
  }
}

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
  "casdoor_avatar",
  "casdoor_linked_at",
  "casdoor_auth_at",
] as const;

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
    casdoor_avatar: profile.avatar,
    casdoor_linked_at: new Date(authAt).toISOString(),
    casdoor_auth_at: authAt,
  };
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

/**
 * Login mode: find (or create) the Supabase Auth user behind a Casdoor
 * identity, then return a short-lived email OTP that the route handler
 * exchanges into a cookie-backed Supabase session. Matching by email links
 * an existing CRM user automatically; conflicting links are rejected.
 */
export async function provisionCasdoorSession(
  profile: CasdoorProfile,
  authAt: number
): Promise<CasdoorSessionSeed> {
  const admin = createServiceClient();
  const email = normalizeEmail(profile.email);

  const { data: existingBinding, error: bindingError } = await admin
    .from("crm_casdoor_sessions")
    .select("user_id")
    .eq("sub", profile.sub)
    .maybeSingle<{ user_id: string }>();
  if (bindingError) {
    throw new CasdoorLinkError("failed", `Casdoor link lookup failed: ${bindingError.message}`);
  }

  const match = await findUserByEmail(email);
  if (!match && existingBinding) {
    throw new CasdoorLinkError(
      "conflict",
      "This Casdoor account belongs to another CRM user; sign in to that account or unlink it first"
    );
  }
  if (match) {
    assertCanLink(
      profile,
      match.id,
      existingBinding,
      (match.user_metadata ?? {}) as Record<string, unknown>
    );
  }

  let userId = match?.id ?? "";
  const existingMetadata = (match?.user_metadata ?? {}) as Record<string, unknown>;
  const metadata = { ...existingMetadata, ...profileMetadata(profile, authAt) };

  if (userId) {
    const { error } = await admin.auth.admin.updateUserById(userId, { user_metadata: metadata });
    if (error) throw new CasdoorLinkError("failed", `Supabase user update failed: ${error.message}`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: profile.displayName, avatar_url: profile.avatar ?? "", ...metadata },
    });
    if (error || !data.user) {
      throw new CasdoorLinkError(
        "failed",
        `Supabase user creation failed: ${error?.message ?? "unknown error"}`
      );
    }
    userId = data.user.id;
  }

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

  const { error: sessionError } = await admin.from("crm_casdoor_sessions").upsert(
    { sub: profile.sub, user_id: userId, logout_at: null, updated_at: new Date(authAt).toISOString() },
    { onConflict: "sub" }
  );
  if (sessionError) {
    throw new CasdoorLinkError("failed", `Casdoor session link failed: ${sessionError.message}`);
  }

  return { email, otp: emailOtp, userId };
}

/**
 * Explicit link mode: attach the Casdoor identity to the currently signed-in
 * CRM user, even when the Casdoor email differs. Does not create or switch
 * users, and does not open a new session.
 */
export async function linkCasdoorAccount(profile: CasdoorProfile, userId: string): Promise<void> {
  const admin = createServiceClient();
  const authAt = Date.now();

  const { data: user, error: userError } = await admin.auth.admin.getUserById(userId);
  if (userError || !user.user) {
    throw new CasdoorLinkError("not_found", "Current CRM user could not be loaded");
  }

  const { data: existingBinding, error: bindingError } = await admin
    .from("crm_casdoor_sessions")
    .select("user_id")
    .eq("sub", profile.sub)
    .maybeSingle<{ user_id: string }>();
  if (bindingError) {
    throw new CasdoorLinkError("failed", `Casdoor link lookup failed: ${bindingError.message}`);
  }

  assertCanLink(
    profile,
    userId,
    existingBinding,
    (user.user.user_metadata ?? {}) as Record<string, unknown>
  );

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

/** Returns the Casdoor binding for a CRM user, if any. */
export async function getCasdoorLink(userId: string): Promise<{ sub: string; logoutAt: string | null } | null> {
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
}

/** Copies the imported Casdoor name/title into the editable CRM profile. */
export async function syncCasdoorProfile(userId: string): Promise<{ fullName: string; title: string | null } | null> {
  const admin = createServiceClient();
  const { data: user, error: userError } = await admin.auth.admin.getUserById(userId);
  if (userError || !user.user) {
    throw new CasdoorLinkError("not_found", "Current CRM user could not be loaded");
  }

  const metadata = (user.user.user_metadata ?? {}) as Record<string, unknown>;
  const fullName = typeof metadata.casdoor_display_name === "string" ? metadata.casdoor_display_name.trim() : "";
  const title = typeof metadata.casdoor_title === "string" ? metadata.casdoor_title.trim() : "";
  if (!fullName) return null;

  const { error } = await admin
    .from("crm_users")
    .update({ full_name: fullName.slice(0, 120), title: title ? title.slice(0, 120) : null })
    .eq("id", userId);
  if (error) throw new CasdoorLinkError("failed", `Profile sync failed: ${error.message}`);

  return { fullName: fullName.slice(0, 120), title: title ? title.slice(0, 120) : null };
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
