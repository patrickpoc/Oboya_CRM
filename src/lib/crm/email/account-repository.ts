import "server-only";

import type { CrmSupabaseClient } from "@/lib/supabase/server";
import { encryptSecret } from "./credentials";
import {
  ACCOUNT_COLUMNS,
  decodeAccountCursor,
  encodeAccountCursor,
  rowToAccount,
  type AccountRow,
  type AccountSecretRow,
} from "./rows";
import type { EmailAccount } from "./types";
import type { EmailAccountInput } from "./schemas";

async function purgeDeleted(supabase: CrmSupabaseClient) {
  const { error } = await supabase.rpc("crm_email_accounts_retention", { p_batch: 200 });
  if (error) console.error("email account retention failed:", error.message);
}

export async function listAccounts(
  supabase: CrmSupabaseClient,
  userId: string,
  cursorValue?: string,
  limit = 50
): Promise<{ accounts: EmailAccount[]; nextCursor: string | null }> {
  const cursor = decodeAccountCursor(cursorValue);
  let query = supabase
    .from("crm_email_accounts")
    .select(`${ACCOUNT_COLUMNS}, created_at`)
    .eq("owner_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100) + 1);

  if (cursor) {
    query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
  }

  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as Array<AccountRow & { created_at: string }>;
  const hasMore = rows.length > Math.min(Math.max(limit, 1), 100);
  const page = hasMore ? rows.slice(0, -1) : rows;
  return {
    accounts: page.map(rowToAccount),
    nextCursor: hasMore && page.length ? encodeAccountCursor(page[page.length - 1]) : null,
  };
}

export async function loadSecretAccount(
  supabase: CrmSupabaseClient,
  userId: string,
  accountId: string
): Promise<AccountSecretRow | null> {
  const { data, error } = await supabase
    .from("crm_email_accounts")
    .select(`${ACCOUNT_COLUMNS}, password_encrypted`)
    .eq("id", accountId)
    .eq("owner_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  return (data as AccountSecretRow | null) ?? null;
}

export async function saveAccount(
  supabase: CrmSupabaseClient,
  userId: string,
  input: EmailAccountInput
): Promise<EmailAccount> {
  const existing = input.id ? await loadSecretAccount(supabase, userId, input.id) : null;
  if (input.id && !existing) throw new Error("not_found");

  if (!input.password && !existing) throw new Error("Password is required for a new mailbox");

  const passwordEncrypted = input.password ? encryptSecret(input.password) : existing!.password_encrypted;
  const values = {
    label: input.label,
    email: input.email,
    provider: input.provider,
    username: input.username,
    password_encrypted: passwordEncrypted,
    smtp_host: input.smtpHost,
    smtp_port: input.smtpPort,
    smtp_secure: input.smtpSecure,
    imap_host: input.imapHost,
    imap_port: input.imapPort,
    imap_secure: input.imapSecure,
    color: input.color,
    enabled: input.enabled,
  };

  const query = existing
    ? supabase.from("crm_email_accounts").update(values).eq("id", existing.id).eq("owner_id", userId)
    : supabase.from("crm_email_accounts").insert({ ...values, owner_id: userId });

  const { data, error } = await query.select(ACCOUNT_COLUMNS).single();
  if (error) throw error;
  await purgeDeleted(supabase);
  return rowToAccount(data as AccountRow);
}

export async function deleteAccount(
  supabase: CrmSupabaseClient,
  userId: string,
  accountId: string
): Promise<void> {
  const { error } = await supabase
    .from("crm_email_accounts")
    .update({ deleted_at: new Date().toISOString(), deleted_by: userId, enabled: false })
    .eq("id", accountId)
    .eq("owner_id", userId)
    .is("deleted_at", null);
  if (error) throw error;
  await purgeDeleted(supabase);
}

export async function touchSynced(
  supabase: CrmSupabaseClient,
  userId: string,
  accountId: string
): Promise<void> {
  const { error } = await supabase
    .from("crm_email_accounts")
    .update({ last_sync_at: new Date().toISOString() })
    .eq("id", accountId)
    .eq("owner_id", userId)
    .is("deleted_at", null);
  if (error) throw error;
}

export function accountForBridge(account: EmailAccount, password: string) {
  return {
    imap: {
      host: account.imapHost,
      port: account.imapPort,
      secure: account.imapSecure,
      auth: { user: account.username, pass: password },
    },
    smtp: {
      host: account.smtpHost,
      port: account.smtpPort,
      secure: account.smtpSecure,
      auth: { user: account.username, pass: password },
    },
  };
}
