/**
 * Casdoor OIDC profile mapping. Casdoor's /api/userinfo follows the standard
 * claim mapping; /api/get-account returns the full Casdoor user object and is
 * needed for the employee/customer policy fields (type, tag, roles, owner).
 */
export type CasdoorProfile = {
  sub: string;
  email: string;
  displayName: string;
  avatar: string | null;
  title: string | null;
  country: string | null;
  countryCode: string | null;
  location: string | null;
  casdoorType: string | null;
  casdoorTags: string[];
  casdoorRoles: string[];
  organization: string | null;
};

type JsonRecord = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optional(value: unknown): string | null {
  const trimmed = text(value);
  return trimmed || null;
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** `/api/userinfo` returns `address` as a plain location string. */
function claimCountry(userInfo: JsonRecord, account: JsonRecord | null): string | null {
  return (
    optional(userInfo.address) ||
    optional(account?.location) ||
    optional(account?.region) ||
    optional(account?.countryCode)
  );
}

function stringList(value: unknown): string[] {
  const items = typeof value === "string" ? value.split(",") : Array.isArray(value) ? value : [];
  return items
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        const record = item as JsonRecord;
        return text(record.name) || text(record.id);
      }
      return "";
    })
    .filter(Boolean);
}

export function mapCasdoorProfile(userInfo: JsonRecord, account: JsonRecord | null = null): CasdoorProfile {
  const sub = text(userInfo.sub) || text(account?.id) || text(account?.name);
  const email = text(userInfo.email) || text(account?.email);
  const displayName =
    text(userInfo.name) ||
    text(userInfo.preferred_username) ||
    text(account?.displayName) ||
    text(account?.name) ||
    email.split("@")[0];

  if (!sub) throw new Error("Casdoor profile is missing 'sub'");
  if (!validEmail(email)) throw new Error("Casdoor profile is missing a valid email");

  return {
    sub,
    email: email.toLowerCase(),
    displayName: displayName || sub,
    avatar: optional(userInfo.picture) || optional(account?.avatar),
    title: optional(userInfo.title) || optional(account?.title),
    country: claimCountry(userInfo, account),
    countryCode: optional(account?.countryCode),
    location: optional(account?.location) || optional(account?.region),
    casdoorType: optional(account?.type),
    casdoorTags: stringList(account?.tag ?? account?.tags),
    casdoorRoles: stringList(account?.roles),
    organization: optional(account?.owner) || optional(account?.organization),
  };
}

async function readJson(response: Response): Promise<JsonRecord> {
  if (!response.ok) {
    throw new Error(`Casdoor profile request failed (${response.status})`);
  }
  const value: unknown = await response.json();
  if (!value || typeof value !== "object") {
    throw new Error("Casdoor returned an unexpected profile payload");
  }
  return value as JsonRecord;
}

/** Some Casdoor versions wrap /api/get-account in `{ status, data }`. */
function unwrapAccount(value: JsonRecord): JsonRecord {
  const data = value.data;
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as JsonRecord)
    : value;
}

/**
 * The ID token arrives directly from Casdoor's token endpoint over TLS. Its
 * claims are a safe fallback when /api/userinfo omits email or sub (a common
 * Casdoor token-format setting); it is never used as proof by itself because
 * the code exchange has already authenticated it.
 */
function decodeIdTokenClaims(idToken: string | null | undefined): JsonRecord {
  if (!idToken) return {};
  const parts = idToken.split(".");
  if (parts.length < 2) return {};
  try {
    const value: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as JsonRecord)
      : {};
  } catch {
    return {};
  }
}

export async function fetchCasdoorProfile(
  endpoints: { userinfoUrl: string; accountUrl: string },
  accessToken: string,
  idToken?: string | null
): Promise<CasdoorProfile> {
  const userInfo = await readJson(
    await fetch(endpoints.userinfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    })
  );
  // Userinfo claims win; only missing fields are filled from the ID token.
  const claims: JsonRecord = { ...decodeIdTokenClaims(idToken), ...userInfo };

  // Always try the account endpoint: OIDC scopes do not expose Casdoor's
  // user type/tags, which decide whether this is an employee or a customer.
  let account: JsonRecord | null = null;
  try {
    account = unwrapAccount(
      await readJson(
        await fetch(`${endpoints.accountUrl}?accessToken=${encodeURIComponent(accessToken)}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        })
      )
    );
  } catch {
    // Keep the OIDC claims; policy fields stay null and fail closed.
  }

  return mapCasdoorProfile(claims, account);
}
