import "server-only";


/** httpOnly marker set by /auth/callback after a password-recovery code exchange. */
export const RECOVERY_COOKIE = "crm_pw_recovery";
export const RECOVERY_MAX_AGE_SECONDS = 15 * 60;

/** True when the access token's `amr` claim says the session came from a recovery link. */
export function isRecoveryAccessToken(accessToken: string): boolean {
  try {
    const payload = accessToken.split(".")[1];
    const json = JSON.parse(
      Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")
    ) as { amr?: Array<{ method?: string }> };
    return Array.isArray(json.amr) && json.amr.some((entry) => entry?.method === "recovery");
  } catch {
    return false;
  }
}
