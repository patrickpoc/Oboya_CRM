"use client";

import { apiFetch } from "@/components/crm/common/api";
import { mapLimit } from "./map-limit";
import {
  cacheAttachment,
  cacheBody,
  cacheContactMatches,
  cacheHeaders,
  cacheSearchHeaders,
  cachedAttachment,
  cachedBody,
  cachedSyncState,
  attachmentKey,
  markHeaderFlags,
  removeCachedHeaders,
} from "./local-db";
import type { CrmEmailMatch, EmailAccount, MailBody, MailHeader, MailSyncPage } from "./types";

export type MailAction = "read" | "unread" | "flag" | "unflag" | "delete";

function syncUrl(accountId: string, folder: string, sinceUid: number | null, limit: number): string {
  const params = new URLSearchParams({ accountId, folder, limit: String(limit) });
  if (sinceUid) params.set("sinceUid", String(sinceUid));
  return `/api/crm/email/sync?${params}`;
}

/** Bounded parallel sync across accounts/folders; each folder keeps its own UID cursor. */
export async function syncMailboxes(
  accounts: EmailAccount[],
  folders: string[],
  limit = 100,
  concurrency = 3
): Promise<{ synced: number; failed: string[] }> {
  const jobs = accounts.filter((account) => account.enabled).flatMap((account) => folders.map((folder) => ({ account, folder })));
  const results = await mapLimit(jobs, concurrency, async ({ account, folder }) => {
    try {
      const state = await cachedSyncState(account.id, folder);
      const page = await apiFetch<MailSyncPage>(syncUrl(account.id, folder, state?.lastUid ?? null, limit), {
        quiet: true,
      });
      return { count: await cacheHeaders(account.id, folder, page.items, page.nextUid), failed: null };
    } catch {
      return { count: 0, failed: `${account.label} · ${folder}` };
    }
  });

  return {
    synced: results.reduce((sum, entry) => sum + entry.count, 0),
    failed: results.map((entry) => entry.failed).filter((entry): entry is string => Boolean(entry)),
  };
}

export async function loadMailBody(header: MailHeader): Promise<MailBody> {
  const cached = await cachedBody(header.id);
  if (cached) return cached;
  const params = new URLSearchParams({ accountId: header.accountId, folder: header.folder, uid: String(header.uid) });
  const body = await apiFetch<MailBody>(`/api/crm/email/message?${params}`);
  await cacheBody(body);
  return body;
}

export async function loadAttachmentBlob(header: MailHeader, part: string, filename: string, contentType: string): Promise<Blob> {
  const key = attachmentKey(header.id, part);
  const cached = await cachedAttachment(key);
  if (cached) return cached.blob;
  const params = new URLSearchParams({
    accountId: header.accountId,
    folder: header.folder,
    uid: String(header.uid),
    part,
  });
  const response = await fetch(`/api/crm/email/attachment?${params}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`attachment ${response.status}`);
  const blob = await response.blob();
  await cacheAttachment({
    key,
    headerId: header.id,
    part,
    filename,
    contentType,
    blob,
    cachedAt: new Date().toISOString(),
  });
  return blob;
}

export async function applyMailAction(headers: MailHeader[], action: MailAction): Promise<void> {
  const unique = [...new Map(headers.map((header) => [header.id, header])).values()];
  if (unique.length === 0) return;
  await mapLimit(unique, 3, async (header) =>
    apiFetch("/api/crm/email/flags", {
      method: "POST",
      body: JSON.stringify({
        accountId: header.accountId,
        folder: header.folder,
        uid: header.uid,
        action,
      }),
    })
  );
  const ids = unique.map((header) => header.id);
  if (action === "delete") await removeCachedHeaders(ids);
  else if (action === "read") await markHeaderFlags(ids, { seen: true });
  else if (action === "unread") await markHeaderFlags(ids, { seen: false });
  else if (action === "flag") await markHeaderFlags(ids, { flagged: true });
  else await markHeaderFlags(ids, { flagged: false });
}

export type EmailDraftPayload = {
  accountId: string;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  html: string;
  inReplyTo?: string;
  logRecordId?: string;
  logRecordType?: "contact" | "account";
};

export async function sendEmailMessage(payload: EmailDraftPayload): Promise<{ messageId: string }> {
  return apiFetch("/api/crm/email/send", { method: "POST", body: JSON.stringify(payload) });
}

export async function findCrmMatches(emails: string[]): Promise<CrmEmailMatch[]> {
  const unique = [...new Set(emails.map((entry) => entry.trim().toLowerCase()).filter(Boolean))].slice(0, 200);
  if (!unique.length) return [];
  const response = await apiFetch<{ matches: CrmEmailMatch[] }>(
    `/api/crm/email/matches?emails=${encodeURIComponent(unique.join(","))}`,
    { quiet: true }
  );
  await cacheContactMatches(response.matches);
  return response.matches;
}

export async function searchAccountHistory(
  account: EmailAccount,
  folder: string,
  address: string,
  limit = 100
): Promise<MailHeader[]> {
  const params = new URLSearchParams({ accountId: account.id, folder, q: address, limit: String(limit) });
  const response = await apiFetch<{ items: MailHeader[] }>(`/api/crm/email/search?${params}`, { quiet: true });
  await cacheSearchHeaders(account.id, folder, response.items);
  return response.items;
}
