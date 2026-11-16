export const DEFAULT_AFTER_LOGIN = "/dashboard";

/** Paths a post-login `next` must never point at (auth flow pages). */
const BLOCKED_PREFIXES = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/change-password",
  "/auth",
  "/api",
];

/**
 * Same-origin, relative path only (no protocol-relative, no backslashes,
 * no encoded separators). Anything else falls back to the dashboard.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next) return DEFAULT_AFTER_LOGIN;
  const value = next.trim();
  if (!value.startsWith("/")) return DEFAULT_AFTER_LOGIN;
  if (value.startsWith("//") || value.startsWith("/\\")) return DEFAULT_AFTER_LOGIN;
  if (value.includes("://") || value.includes("@") || value.includes("\\")) {
    return DEFAULT_AFTER_LOGIN;
  }
  if (/%2f|%5c|%40|[\u0000-\u001f]/i.test(value)) return DEFAULT_AFTER_LOGIN;
  const path = value.split(/[?#]/)[0];
  if (BLOCKED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    return DEFAULT_AFTER_LOGIN;
  }
  return value;
}
