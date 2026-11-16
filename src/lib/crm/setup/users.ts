/*
 * Guard rails for Setup -> Users, mirrored from crm_users_guard
 * (supabase/migrations/20261116000100_crm_core.sql): nobody changes their own
 * role or status, and the last active super_admin cannot be demoted or disabled.
 */

export type UserStatus = "active" | "disabled";

export type GuardTarget = { id: string; role: string; status: UserStatus };
export type GuardPatch = { role?: string; status?: UserStatus };

export type UserGuardError = "self_role" | "self_status" | "last_super_admin" | "super_admin_only";

export function checkUserUpdate(input: {
  actor: { id: string; role: string };
  target: GuardTarget;
  patch: GuardPatch;
  /** ids of every user that is currently an active super_admin */
  activeSuperAdminIds: readonly string[];
}): UserGuardError | null {
  const { actor, target, patch, activeSuperAdminIds } = input;
  const roleChanges = patch.role !== undefined && patch.role !== target.role;
  const statusChanges = patch.status !== undefined && patch.status !== target.status;

  if (actor.id === target.id) {
    if (roleChanges) return "self_role";
    if (statusChanges) return "self_status";
  }

  // Only a super admin grants, edits or removes super admin access.
  if (actor.role !== "super_admin" && (patch.role === "super_admin" || target.role === "super_admin")) {
    if (roleChanges || statusChanges || target.role === "super_admin") return "super_admin_only";
  }

  const nextRole = patch.role ?? target.role;
  const nextStatus = patch.status ?? target.status;
  const losesSuperAdmin =
    target.role === "super_admin" &&
    target.status === "active" &&
    (nextRole !== "super_admin" || nextStatus !== "active");
  if (losesSuperAdmin && !activeSuperAdminIds.some((id) => id !== target.id)) {
    return "last_super_admin";
  }
  return null;
}

/** Super admins can assign any active role; others never assign super_admin. */
export function canAssignRole(actorRole: string, roleId: string): boolean {
  return roleId !== "super_admin" || actorRole === "super_admin";
}

const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";

/**
 * One-time password shown once to the admin (reference behaviour). Rejection
 * sampling keeps every character equally likely.
 */
export function generateTemporaryPassword(
  length = 20,
  randomBytes: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))
): string {
  const limit = 256 - (256 % PASSWORD_ALPHABET.length);
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < limit) out += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}
