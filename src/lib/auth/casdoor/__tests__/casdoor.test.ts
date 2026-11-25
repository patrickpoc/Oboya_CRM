import { describe, expect, it, vi } from "vitest";
import {
  buildAuthorizeUrl,
  createOAuthState,
  createPkceChallenge,
  safeEqual,
} from "../pkce";
import { mapCasdoorProfile } from "../profile";
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
          countryCode: "CN",
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
    });
  });

  it("rejects a profile without an email", () => {
    expect(() => mapCasdoorProfile({ sub: "sub-3" })).toThrow(/email/i);
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
