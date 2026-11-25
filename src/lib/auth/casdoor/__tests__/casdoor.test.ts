import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAuthorizeUrl,
  createOAuthState,
  createPkceChallenge,
  safeEqual,
} from "../pkce";
import { evaluateCasdoorPolicy } from "../policy";
import { fetchCasdoorProfile, mapCasdoorProfile } from "../profile";
import { isCasdoorSessionRevoked } from "../revocation";

describe("Casdoor OAuth helpers", () => {
  it("uses the RFC 7636 S256 challenge vector", () => {
    expect(createPkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
  });

  it("builds an authorize URL with PKCE and standard OIDC scopes", () => {
    const url = new URL(
      buildAuthorizeUrl(
        {
          authorizeUrl: "https://oboss.psorai.eu.org/login/oauth/authorize",
          clientId: "51a7f410327c44d55e4e",
          redirectUri: "https://oboyacrm.vercel.app/callback",
        },
        { state: "state-123", codeChallenge: "challenge-456" }
      )
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid profile email");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("redirect_uri")).toBe("https://oboyacrm.vercel.app/callback");
  });

  it("creates distinct opaque states and compares them safely", () => {
    const a = createOAuthState();
    const b = createOAuthState();
    expect(a).not.toBe(b);
    expect(safeEqual(a, a)).toBe(true);
    expect(safeEqual(a, b)).toBe(false);
    expect(safeEqual(a, null)).toBe(false);
  });
});

describe("Casdoor profile mapping", () => {
  it("maps standard OIDC claims", () => {
    expect(
      mapCasdoorProfile({
        sub: "7a6b4a8a-b731-48da-bc44-36ae27338817",
        email: "Alice@Example.COM",
        name: "Alice Chen",
        picture: "https://example.com/a.png",
      })
    ).toEqual({
      sub: "7a6b4a8a-b731-48da-bc44-36ae27338817",
      email: "alice@example.com",
      displayName: "Alice Chen",
      avatar: "https://example.com/a.png",
      title: null,
      country: null,
      countryCode: null,
      location: null,
      phone: null,
      region: null,
      company: null,
      casdoorType: null,
      casdoorTags: [],
      casdoorRoles: [],
      organization: null,
    });
  });

  it("falls back to the Casdoor account endpoint and imports country/title", () => {
    expect(
      mapCasdoorProfile(
        { address: "Shanghai" },
        {
          id: "sub-2",
          email: "bob@example.com",
          displayName: "Bob",
          title: "Sales Manager",
          location: "Shanghai",
          region: "Shanghai",
          countryCode: "CN",
          phone: "+86 138 0000 0000",
          affiliation: "Oboya Horticulture",
          type: "normal-user",
          tag: "employee,vip",
          roles: ["sales", "manager"],
          owner: "oboya",
        }
      )
    ).toEqual({
      sub: "sub-2",
      email: "bob@example.com",
      displayName: "Bob",
      avatar: null,
      title: "Sales Manager",
      country: "Shanghai",
      countryCode: "CN",
      location: "Shanghai",
      phone: "+86 138 0000 0000",
      region: "Shanghai",
      company: "Oboya Horticulture",
      casdoorType: "normal-user",
      casdoorTags: ["employee", "vip"],
      casdoorRoles: ["sales", "manager"],
      organization: "oboya",
    });
  });

  it("maps custom signup properties and normalizes the country code", () => {
    expect(
      mapCasdoorProfile({
        sub: "sub-4",
        email: "dan@example.com",
        properties: { country: "China", phone: "123456789", company: "OBOYA Design Studio" },
      })
    ).toMatchObject({
      country: "China",
      countryCode: "CN",
      phone: "123456789",
      company: "OBOYA Design Studio",
    });
  });

  it("rejects a profile without an email", () => {
    expect(() => mapCasdoorProfile({ sub: "sub-3" })).toThrow(/email/i);
  });
});

describe("Casdoor profile fetch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("falls back to ID token claims when userinfo omits email and sub", async () => {
    const claims = { sub: "sub-9", email: "carol@oboya.cc", name: "Carol" };
    const idToken = `header.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) =>
        Promise.resolve(
          new Response(
            JSON.stringify(url.includes("userinfo") ? {} : { status: "error" }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        )
      )
    );

    const profile = await fetchCasdoorProfile(
      {
        userinfoUrl: "https://oboss.psorai.eu.org/api/userinfo",
        accountUrl: "https://oboss.psorai.eu.org/api/get-account",
      },
      "access-token",
      idToken
    );
    expect(profile.sub).toBe("sub-9");
    expect(profile.email).toBe("carol@oboya.cc");
    expect(profile.displayName).toBe("Carol");
  });
});

describe("Casdoor employee policy", () => {
  const envKeys = [
    "CASDOOR_ALLOWED_EMAIL_DOMAINS",
    "CASDOOR_ALLOWED_USER_TYPES",
    "CASDOOR_ALLOWED_ORGANIZATIONS",
  ] as const;
  const original: Record<string, string | undefined> = Object.fromEntries(
    envKeys.map((key) => [key, process.env[key]])
  );

  afterEach(() => {
    for (const key of envKeys) {
      const value = original[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const profile = {
    ...mapCasdoorProfile({
      sub: "employee-1",
      email: "alice@oboya.cc",
      name: "Alice",
    }),
    casdoorType: "normal-user",
    organization: "oboya",
  };

  it("rejects non-employee Casdoor account types by default", () => {
    delete process.env.CASDOOR_ALLOWED_USER_TYPES;
    expect(evaluateCasdoorPolicy({ ...profile, casdoorType: "guest-user" })).toMatchObject({
      allowed: false,
      code: "account_type",
    });
    expect(evaluateCasdoorPolicy({ ...profile, casdoorType: "normal-user" })).toEqual({
      allowed: true,
    });
  });

  it("rejects email domains outside the allowlist", () => {
    process.env.CASDOOR_ALLOWED_EMAIL_DOMAINS = "oboya.cc, oboya-horticulture.com";
    expect(evaluateCasdoorPolicy({ ...profile, email: "buyer@customer.com" })).toMatchObject({
      allowed: false,
      code: "email_domain",
    });
    expect(evaluateCasdoorPolicy(profile)).toEqual({ allowed: true });
  });

  it("rejects organizations outside the allowlist", () => {
    process.env.CASDOOR_ALLOWED_ORGANIZATIONS = "oboya";
    expect(evaluateCasdoorPolicy({ ...profile, organization: "customers" })).toMatchObject({
      allowed: false,
      code: "organization",
    });
    expect(evaluateCasdoorPolicy({ ...profile, organization: "oboya" })).toEqual({ allowed: true });
  });
});

describe("Casdoor back-channel logout enforcement", () => {
  const user = {
    id: "user-1",
    user_metadata: { casdoor_sub: "sub-1", casdoor_auth_at: 1_700_000_000_000 },
  } as unknown as Parameters<typeof isCasdoorSessionRevoked>[1];

  function clientWith(logoutAt: string | null) {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { logout_at: logoutAt }, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    return { client: { from } as unknown as Parameters<typeof isCasdoorSessionRevoked>[0], from };
  }

  it("rejects a session opened before the logout timestamp", async () => {
    const { client, from } = clientWith("2023-11-15T00:00:00.000Z");
    expect(await isCasdoorSessionRevoked(client, user)).toBe(true);
    expect(from).toHaveBeenCalledWith("crm_casdoor_sessions");
  });

  it("keeps a session opened after the logout timestamp", async () => {
    const { client } = clientWith("2022-01-01T00:00:00.000Z");
    expect(await isCasdoorSessionRevoked(client, user)).toBe(false);
  });

  it("ignores users without a Casdoor link", async () => {
    const { client, from } = clientWith("2026-01-01T00:00:00.000Z");
    expect(
      await isCasdoorSessionRevoked(client, { ...user, user_metadata: {} } as typeof user)
    ).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });
});
