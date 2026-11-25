/**
 * Casdoor OIDC profile mapping. Casdoor's /api/userinfo follows the standard
 * claim mapping; /api/get-account enriches it with Casdoor-specific fields
 * (title, location/region/country code) when the token format omits them.
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
  };
}

async function readJson(response: Response): Promise<JsonRecord> {
  if (!response.ok) {
    throw new Error(`Casdoor profile request failed (${response.status})`);
  }
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Casdoor returned an unexpected profile payload");
  }
  return value as JsonRecord;
}

export async function fetchCasdoorProfile(
  endpoints: { userinfoUrl: string; accountUrl: string },
  accessToken: string
): Promise<CasdoorProfile> {
  const userInfo = await readJson(
    await fetch(endpoints.userinfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
    })
  );

  // Enrichment is best effort: the application's token format may omit the
  // email or Casdoor-specific claims even though the token is still valid.
  const needsAccount =
    !text(userInfo.email) ||
    !text(userInfo.sub) ||
    !optional(userInfo.address) ||
    !optional(userInfo.title);
  let account: JsonRecord | null = null;
  if (needsAccount) {
    try {
      account = await readJson(
        await fetch(`${endpoints.accountUrl}?accessToken=${encodeURIComponent(accessToken)}`, {
          cache: "no-store",
        })
      );
    } catch {
      // Keep the standard OIDC claims; optional fields stay null.
    }
  }

  return mapCasdoorProfile(userInfo, account);
}
