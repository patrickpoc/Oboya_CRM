import "server-only";

import type { CrmSupabaseClient } from "@/lib/supabase/server";
import { loadSecretAccount, accountForBridge } from "./account-repository";
import { decryptSecret } from "./credentials";
import { rowToAccount } from "./rows";
import type { CrmEmailMatch, EmailAccount } from "./types";

export type BridgeAccount = {
  account: EmailAccount;
  imap: ReturnType<typeof accountForBridge>["imap"];
  smtp: ReturnType<typeof accountForBridge>["smtp"];
};

export async function resolveBridgeAccount(
  supabase: CrmSupabaseClient,
  userId: string,
  accountId: string
): Promise<BridgeAccount | null> {
  const row = await loadSecretAccount(supabase, userId, accountId);
  if (!row || !row.enabled) return null;
  const account = rowToAccount(row);
  const password = decryptSecret(row.password_encrypted);
  return { account, ...accountForBridge(account, password) };
}

async function matchRpc(supabase: CrmSupabaseClient, fn: string, emails: string[]): Promise<CrmEmailMatch[]> {
  const unique = [...new Set(emails.map((entry) => entry.trim().toLowerCase()).filter(Boolean))].slice(0, 200);
  if (unique.length === 0) return [];
  const { data, error } = await supabase.rpc(fn, { p_emails: unique });
  if (error) throw error;
  return ((data ?? []) as CrmEmailMatch[]).filter((entry) => entry?.id);
}

export function matchContacts(supabase: CrmSupabaseClient, emails: string[]): Promise<CrmEmailMatch[]> {
  return matchRpc(supabase, "crm_email_match_contacts", emails);
}

export function matchAccounts(supabase: CrmSupabaseClient, emails: string[]): Promise<CrmEmailMatch[]> {
  return matchRpc(supabase, "crm_email_match_accounts", emails);
}
