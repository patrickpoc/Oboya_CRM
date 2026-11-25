/**
 * Casdoor OIDC profile mapping. Casdoor's /api/userinfo follows the standard
 * claim mapping; /api/get-account returns the full Casdoor user object and is
 * needed for the employee/customer policy fields (type, tag, roles, owner) and
 * for signup fields such as countryCode, region, phone and affiliation.
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
  phone: string | null;
  region: string | null;
  /** Casdoor "affiliation" / work unit. */
  company: string | null;
  casdoorType: string | null;
  casdoorTags: string[];
  casdoorRoles: string[];
  organization: string | null;
};

type JsonRecord = Record<string, unknown>;

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function optional(value: unknown): string | null {
  const trimmed = text(value);
  return trimmed || null;
}

function jsonRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function pick(...values: unknown[]): string | null {
  for (const value of values) {
    const found = optional(value);
    if (found) return found;
  }
  return null;
}

function fromProperties(record: JsonRecord | null, ...keys: string[]): string | null {
  if (!record) return null;
  return pick(...keys.map(key => record[key]));
}

function firstListName(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    const found = typeof item === "string" ? optional(item) : optional(jsonRecord(item)?.name);
    if (found) return found;
  }
  return null;
}

/** CRM picklists use ISO-style two-letter codes; map common Casdoor values. */
export function normalizeCountryCode(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  const aliases: Record<string, string> = {
    CHINA: "CN", "中国": "CN",
    USA: "US", AMERICA: "US", "美国": "US",
    NETHERLANDS: "NL", HOLLAND: "NL", "荷兰": "NL",
    GERMANY: "DE", DEUTSCHLAND: "DE", "德国": "DE",
    UNITEDKINGDOM: "GB", ENGLAND: "GB", "英国": "GB",
    COLOMBIA: "CO", "哥伦比亚": "CO",
    ECUADOR: "EC", "厄瓜多尔": "EC",
  };
  return aliases[upper] ?? aliases[raw] ?? null;
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** `/api/userinfo` returns `address` as a plain location string. */
function claimCountry(userInfo: JsonRecord, account: JsonRecord | null, properties: JsonRecord): string | null {
  return (
    optional(userInfo.address) ||
    optional(account?.location) ||
    optional(account?.region) ||
    optional(account?.countryCode) ||
    fromProperties(properties, "country", "countryCode", "country_region", "countryRegion")
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

  const properties: JsonRecord = { ...(jsonRecord(userInfo.properties) ?? {}), ...(jsonRecord(account?.properties) ?? {}) };

  return {
    sub,
    email: email.toLowerCase(),
    displayName: displayName || sub,
    avatar: optional(userInfo.picture) || optional(account?.avatar),
    title: optional(userInfo.title) || optional(account?.title),
    country: claimCountry(userInfo, account, properties),
    countryCode: normalizeCountryCode(
      pick(account?.countryCode, userInfo.country_code, userInfo.countryCode, userInfo.country) ??
      fromProperties(properties, "countryCode", "country")
    ),
    location: optional(account?.location) || optional(account?.region),
    phone: pick(account?.phone, userInfo.phone, userInfo.phone_number) ??
      fromProperties(properties, "phone", "mobile", "telephone"),
    region: pick(account?.region, userInfo.region) ??
      fromProperties(properties, "region", "state", "province"),
    company: pick(account?.affiliation, userInfo.affiliation, userInfo.company, firstListName(account?.affiliations)) ??
      fromProperties(properties, "company", "affiliation", "workUnit", "work_unit", "工作单位"),
    casdoorType: optional(account?.type) || optional(userInfo.type),
    casdoorTags: stringList(account?.tag ?? account?.tags ?? userInfo.tag ?? userInfo.tags),
    casdoorRoles: stringList(account?.roles ?? userInfo.roles),
    organization: optional(account?.owner) || optional(account?.organization) || optional(userInfo.organization),
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
      signal: AbortSignal.timeout(15_000),
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
          signal: AbortSignal.timeout(15_000),
        })
      )
    );
  } catch {
    // Keep the OIDC claims; policy fields stay null and fail closed.
  }

  return mapCasdoorProfile(claims, account);
}
