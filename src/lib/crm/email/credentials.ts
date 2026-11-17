import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const PREFIX = "v1";

function key(): Buffer {
  const raw = process.env.EMAIL_CREDENTIALS_KEY;
  if (!raw) throw new Error("EMAIL_CREDENTIALS_KEY is not configured");
  const decoded = Buffer.from(raw, "base64");
  if (decoded.length !== 32) throw new Error("EMAIL_CREDENTIALS_KEY must be 32 base64-encoded bytes");
  return decoded;
}

export function hasCredentialsKey(): boolean {
  try {
    key();
    return true;
  } catch {
    return false;
  }
}

/** AES-GCM envelope: v1.<iv>.<tag>.<ciphertext>, all base64 except the prefix. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [PREFIX, iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(".");
}

export function decryptSecret(payload: string): string {
  const [version, ivPart, tagPart, dataPart] = payload.split(".");
  if (version !== PREFIX || !ivPart || !tagPart || !dataPart) {
    throw new Error("Invalid encrypted credential");
  }
  const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivPart, "base64"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataPart, "base64")), decipher.final()]).toString("utf8");
}
