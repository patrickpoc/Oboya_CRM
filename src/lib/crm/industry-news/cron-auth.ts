import { timingSafeEqual } from "node:crypto";

/** Constant-time check for the `Authorization: Bearer <CRON_SECRET>` header. */
export function isCronAuthorized(authorization: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  if (!authorization?.startsWith("Bearer ")) return false;

  const provided = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(secret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
