import "server-only";

/**
 * Casdoor OIDC/OAuth 2.0 relying-party configuration. The client secret is
 * server-only: this module must never be imported by a client component.
 * The defaults match the production Casdoor application ("oboyacrm"); every
 * value can be overridden through the environment.
 */
const DEFAULT_ISSUER = "https://oboss.psorai.eu.org";
const DEFAULT_CLIENT_ID = "51a7f410327c44d55e4e";
const DEFAULT_SIGNUP_URL = "https://oboss.psorai.eu.org/signup/oboyacrm";

function clean(value: string | undefined, fallback = ""): string {
  return value?.trim() || fallback;
}

export type CasdoorConfig = ReturnType<typeof getCasdoorConfig>;

/**
 * `origin` is supplied by route handlers so local development works even when
 * NEXT_PUBLIC_SITE_URL is not set. Vercel deployments should set that variable.
 */
export function getCasdoorConfig(origin?: string) {
  const issuer = clean(process.env.CASDOOR_ISSUER, DEFAULT_ISSUER).replace(/\/+$/, "");
  const clientId = clean(process.env.CASDOOR_CLIENT_ID, DEFAULT_CLIENT_ID);
  const clientSecret = clean(process.env.CASDOOR_CLIENT_SECRET);
  const siteUrl = clean(process.env.NEXT_PUBLIC_SITE_URL).replace(/\/+$/, "");
  const baseUrl = clean(origin)?.replace(/\/+$/, "") || siteUrl;
  const redirectUri = clean(
    process.env.CASDOOR_REDIRECT_URI,
    baseUrl ? `${baseUrl}/callback` : ""
  );
  // Casdoor matches Redirect URLs by scheme/host/port/path, and /login must
  // be registered for the post-logout hop. Keep the default query-free; the
  // signed-out notice is carried by a short-lived first-party cookie.
  const postLogoutUri = clean(
    process.env.CASDOOR_POST_LOGOUT_URI,
    baseUrl ? `${baseUrl}/login` : ""
  );

  return {
    issuer,
    clientId,
    clientSecret,
    redirectUri,
    postLogoutUri,
    signupUrl: clean(process.env.CASDOOR_SIGNUP_URL, DEFAULT_SIGNUP_URL),
    authorizeUrl: `${issuer}/login/oauth/authorize`,
    tokenUrl: `${issuer}/api/login/oauth/access_token`,
    userinfoUrl: `${issuer}/api/userinfo`,
    accountUrl: `${issuer}/api/get-account`,
    logoutUrl: `${issuer}/api/logout`,
    jwksUrl: `${issuer}/.well-known/jwks`,
  };
}

export function isCasdoorConfigured(): boolean {
  const { clientId, clientSecret, redirectUri, postLogoutUri } = getCasdoorConfig();
  return Boolean(clientId && clientSecret && redirectUri && postLogoutUri);
}
