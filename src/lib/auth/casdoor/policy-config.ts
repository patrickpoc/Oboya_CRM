/**
 * Non-secret Casdoor employee policy settings. Kept separate from config.ts so
 * pure policy helpers can be unit tested without loading the server-only
 * configuration module that holds the client secret.
 */
function envList(name: string, fallback: readonly string[]): string[] {
  const raw = process.env[name];
  if (raw === undefined) return [...fallback];
  return raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

/** Cheap pre-filter; an empty list disables the restriction. */
export function getCasdoorAllowedEmailDomains(): string[] {
  return envList("CASDOOR_ALLOWED_EMAIL_DOMAINS", []);
}

/** Casdoor user `type`; `guest-user` accounts are customers, not employees. */
export function getCasdoorAllowedUserTypes(): string[] {
  return envList("CASDOOR_ALLOWED_USER_TYPES", ["normal-user"]);
}

export function getCasdoorAllowedOrganizations(): string[] {
  return envList("CASDOOR_ALLOWED_ORGANIZATIONS", []);
}

function allowed(raw: string | null | undefined, allowlist: string[]): boolean {
  return allowlist.length === 0 || (Boolean(raw) && allowlist.includes(String(raw).toLowerCase()));
}

export function isCasdoorEmailAllowed(email: string): boolean {
  const domain = email.toLowerCase().split("@")[1] ?? "";
  return allowed(domain, getCasdoorAllowedEmailDomains());
}

export function isCasdoorUserTypeAllowed(type: string | null): boolean {
  return allowed(type, getCasdoorAllowedUserTypes());
}

export function isCasdoorOrganizationAllowed(organization: string | null): boolean {
  return allowed(organization, getCasdoorAllowedOrganizations());
}
