import { createHmac, timingSafeEqual } from "node:crypto";

/** Header carrying `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, t + "." + rawBody)>`. */
export const SIGNATURE_HEADER = "x-oboya-signature";
export const SIGNATURE_TOLERANCE_SECONDS = 300;
export const MAX_BODY_BYTES = 64 * 1024;

/** Strict UTF-8 decode of the verified bytes; null when they are not valid UTF-8. */
export function decodeUtf8Strict(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export type SignatureCheck =
  | { ok: true; timestamp: number }
  | { ok: false; reason: "missing" | "malformed" | "expired" | "mismatch" };

/** Raw request bytes, or a string (hashed as its UTF-8 bytes). */
export type RawBody = string | Uint8Array;

/**
 * HMAC over the exact bytes received: `t + "."` then the raw body. Hashing
 * bytes (not a decoded string) means invalid UTF-8 cannot be normalised into
 * a body that verifies.
 */
export function computeSignature(secret: string, timestamp: number | string, rawBody: RawBody): string {
  const bytes = typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : rawBody;
  return createHmac("sha256", secret).update(`${timestamp}.`, "utf8").update(bytes).digest("hex");
}

/** Builds the full header value; used by tests, the docs and scripts/inbound-sign.mjs. */
export function signatureHeader(secret: string, rawBody: RawBody, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${computeSignature(secret, timestamp, rawBody)}`;
}

export function parseSignatureHeader(header: string | null | undefined): { t: number; v1: string[] } | null {
  if (!header) return null;
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq <= 0) return null;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") {
      if (t !== null || !/^\d{1,12}$/.test(value)) return null;
      t = Number(value);
    } else if (key === "v1") {
      if (!/^[0-9a-f]{64}$/i.test(value)) return null;
      v1.push(value.toLowerCase());
    }
    // Unknown keys (future schemes) are ignored.
  }
  if (t === null || v1.length === 0) return null;
  return { t, v1 };
}

function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

export function verifySignature(
  secret: string,
  header: string | null | undefined,
  rawBody: RawBody,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS
): SignatureCheck {
  if (!header) return { ok: false, reason: "missing" };
  const parsed = parseSignatureHeader(header);
  if (!parsed) return { ok: false, reason: "malformed" };
  if (Math.abs(nowSeconds - parsed.t) > toleranceSeconds) return { ok: false, reason: "expired" };
  const expected = computeSignature(secret, parsed.t, rawBody);
  // Check every candidate without short-circuiting.
  let match = false;
  for (const candidate of parsed.v1) {
    if (safeEqualHex(expected, candidate)) match = true;
  }
  return match ? { ok: true, timestamp: parsed.t } : { ok: false, reason: "mismatch" };
}
