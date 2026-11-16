import "server-only";

import { createServiceClient } from "@/lib/supabase/admin";
import { generateTemporaryPassword } from "@/lib/crm/setup/users";

export class AuthUserExistsError extends Error {
  constructor() {
    super("A user with this email already exists");
    this.name = "AuthUserExistsError";
  }
}

/**
 * Creates a confirmed auth user with a one-time password that must be changed
 * on first sign-in (app_metadata is only writable with the service role).
 * The on_auth_user_created trigger inserts a disabled sales_rep crm_users row;
 * the caller activates it with the user-scoped client so RLS (super admin)
 * stays the authority, and calls deleteAuthUser() if that fails.
 */
export async function createAuthUserWithTemporaryPassword(input: {
  email: string;
  fullName: string;
}): Promise<{ id: string; temporaryPassword: string }> {
  const admin = createServiceClient();
  const temporaryPassword = generateTemporaryPassword();
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: temporaryPassword,
    email_confirm: true,
    user_metadata: { full_name: input.fullName },
    app_metadata: { must_change_password: true },
  });
  if (error || !data.user) {
    const message = error?.message ?? "";
    if (error?.status === 422 || /already (been )?registered|already exists/i.test(message)) {
      throw new AuthUserExistsError();
    }
    throw new Error(message || "Auth user creation failed");
  }
  return { id: data.user.id, temporaryPassword };
}

/** Rollback for a half-created user (cascades to crm_users). */
export async function deleteAuthUser(userId: string): Promise<void> {
  const admin = createServiceClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw new Error(error.message);
}
