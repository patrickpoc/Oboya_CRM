import {
  findForbiddenCasdoorTag,
  isCasdoorEmailAllowed,
  isCasdoorOrganizationAllowed,
  isCasdoorUserTypeAllowed,
} from "./policy-config";
import type { CasdoorProfile } from "./profile";

export type CasdoorPolicyCode = "email_domain" | "account_type" | "organization";
export type CasdoorPolicyResult =
  | { allowed: true }
  | { allowed: false; code: CasdoorPolicyCode; message: string };

/**
 * Fast rejection before any review record is written. Passing this check does
 * NOT grant CRM access: an admin still has to approve the specific Casdoor
 * subject. Guests/customers are rejected here when their Casdoor user type or
 * email domain is outside the configured employee allowlist.
 */
export function evaluateCasdoorPolicy(profile: CasdoorProfile): CasdoorPolicyResult {
  if (!isCasdoorEmailAllowed(profile.email)) {
    return { allowed: false, code: "email_domain", message: "Casdoor email domain is not allowed" };
  }
  // Casdoor guest accounts have type=normal-user but tag=guest-user, so the
  // tag must be checked separately to keep customer accounts out.
  const guestTag = findForbiddenCasdoorTag(profile.casdoorTags);
  if (guestTag) {
    return {
      allowed: false,
      code: "account_type",
      message: `Casdoor tag "${guestTag}" identifies a guest/customer account`,
    };
  }
  if (!isCasdoorUserTypeAllowed(profile.casdoorType)) {
    return {
      allowed: false,
      code: "account_type",
      message: "Casdoor account type is not an allowed employee type",
    };
  }
  if (!isCasdoorOrganizationAllowed(profile.organization)) {
    return {
      allowed: false,
      code: "organization",
      message: "Casdoor organization is not allowed",
    };
  }
  return { allowed: true };
}
