import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Casdoor discovery for this instance advertises these standard OIDC scopes. */
const CASDOOR_SCOPES = ["openid", "profile", "email"] as const;

type CasdoorAuthorizeTarget = {
  authorizeUrl: string;
  clientId: string;
  redirectUri: string;
};

/** RFC 7636 PKCE with S256, plus an opaque CSRF state. */
export function createCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

export function createPkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function createOAuthState(): string {
  return randomBytes(24).toString("base64url");
}

/** Constant-time comparison so a state mismatch cannot leak via timing. */
export function safeEqual(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function buildAuthorizeUrl(
  config: CasdoorAuthorizeTarget,
  options: { state: string; codeChallenge: string }
): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    scope: CASDOOR_SCOPES.join(" "),
    state: options.state,
    code_challenge_method: "S256",
    code_challenge: options.codeChallenge,
  });
  // Casdoor documents scopes as space separated; URLSearchParams uses '+'.
  return `${config.authorizeUrl}?${params.toString().replace(/\+/g, "%20")}`;
}
