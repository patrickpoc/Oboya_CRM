import type { EmailAccount, EmailProviderId } from "./types";

export const ACCOUNT_COLUMNS =
  "id, label, email, provider, username, smtp_host, smtp_port, smtp_secure, imap_host, imap_port, imap_secure, color, enabled, last_sync_at, updated_at";

export type AccountRow = {
  id: string;
  label: string;
  email: string;
  provider: EmailProviderId;
  username: string;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  imap_host: string;
  imap_port: number;
  imap_secure: boolean;
  color: string;
  enabled: boolean;
  last_sync_at: string | null;
  updated_at: string;
};

export type AccountSecretRow = AccountRow & { password_encrypted: string };

export function rowToAccount(row: AccountRow): EmailAccount {
  return {
    id: row.id,
    label: row.label,
    email: row.email,
    provider: row.provider,
    username: row.username,
    smtpHost: row.smtp_host,
    smtpPort: row.smtp_port,
    smtpSecure: row.smtp_secure,
    imapHost: row.imap_host,
    imapPort: row.imap_port,
    imapSecure: row.imap_secure,
    color: row.color,
    enabled: row.enabled,
    lastSyncAt: row.last_sync_at,
    updatedAt: row.updated_at,
  };
}

export type AccountCursor = { createdAt: string; id: string };

export function encodeAccountCursor(row: { created_at: string; id: string }): string {
  return Buffer.from(JSON.stringify({ createdAt: row.created_at, id: row.id }), "utf8").toString("base64url");
}

export function decodeAccountCursor(value?: string): AccountCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as AccountCursor;
    if (!parsed || typeof parsed.createdAt !== "string" || typeof parsed.id !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}
