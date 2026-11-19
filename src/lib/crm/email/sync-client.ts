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
  saveSentMessage,
  deleteSentMessage,
  type EmailDatabase,
} from "./local-db";
import type { SentMessage } from "./local-db";
import type { CrmEmailMatch, EmailAccount, MailBody, MailHeader, MailSyncPage } from "./types";
import { MAIL_HEADER_VERSION } from "./types";
import { sentMessageBody } from "./sent";

export type MailAction = "read" | "unread" | "flag" | "unflag" | "delete";

function syncUrl(accountId: string, folder: string, sinceUid: number | null, limit: number): string {
  const params = new URLSearchParams({ accountId, folder, limit: String(limit) });
  if (sinceUid) params.set("sinceUid", String(sinceUid));
  return `/api/crm/email/sync?${params}`;
}

/** Bounded parallel sync across accounts/folders; each folder keeps its own UID cursor. */
export async function syncMailboxes(
  db: EmailDatabase,
  accounts: EmailAccount[],
  folders: string[],
  limit = 100,
  concurrency = 3
): Promise<{ synced: number; failed: string[] }> {
  const jobs = accounts.filter((account) => account.enabled).flatMap((account) => folders.map((folder) => ({ account, folder })));
  const results = await mapLimit(jobs, concurrency, async ({ account, folder }) => {
    try {
      const state = await cachedSyncState(db, account.id, folder);
      const refreshHeaders = state?.headerVersion !== MAIL_HEADER_VERSION;
      const page = await apiFetch<MailSyncPage>(syncUrl(account.id, folder, refreshHeaders ? null : state?.lastUid ?? null, refreshHeaders ? 200 : limit), {
        quiet: true,
      });
      return { count: await cacheHeaders(db, account.id, folder, page.items, page.nextUid), failed: null };
    } catch {
      return { count: 0, failed: `${account.label} · ${folder}` };
    }
  });

  return {
    synced: results.reduce((sum, entry) => sum + entry.count, 0),
    failed: results.map((entry) => entry.failed).filter((entry): entry is string => Boolean(entry)),
  };
}

export async function loadMailBody(db: EmailDatabase, header: MailHeader): Promise<MailBody> {
  if (header.localSentId) {
    const sent = await db.sent.get(header.localSentId);
    if (sent && sent.accountId === header.accountId) return sentMessageBody(sent, header);
  }
  const cached = await cachedBody(db, header.id);
  if (cached && cached.subject !== undefined && cached.references !== undefined) return cached;
  const params = new URLSearchParams({ accountId: header.accountId, folder: header.folder, uid: String(header.uid) });
  const body = await apiFetch<MailBody>(`/api/crm/email/message?${params}`);
  await cacheBody(db, body);
  return body;
}

export async function loadAttachmentBlob(db: EmailDatabase, header: MailHeader, part: string, filename: string, contentType: string): Promise<Blob> {
  if (header.localSentId && part.startsWith("local:")) {
    const sent = await db.sent.get(header.localSentId);
    const attachment = sent?.accountId === header.accountId
      ? sent.attachments.find((entry) => `local:${entry.id}` === part)
      : undefined;
    if (!attachment) throw new Error("Local attachment not found");
    return attachment.blob;
  }
  const key = attachmentKey(header.id, part);
  const cached = await cachedAttachment(db, key);
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
  await cacheAttachment(db, {
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

export async function applyMailAction(db: EmailDatabase, headers: MailHeader[], action: MailAction): Promise<void> {
  const unique = [...new Map(headers.map((header) => [header.id, header])).values()];
  if (unique.length === 0) return;
  await mapLimit(unique.filter((header) => header.uid > 0), 3, async (header) =>
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
  if (action === "delete") {
    await removeCachedHeaders(db, ids);
    await Promise.all(unique.filter((header) => header.localSentId).map((header) => deleteSentMessage(db, header.localSentId!)));
  }
  else if (action === "read") await markHeaderFlags(db, ids, { seen: true });
  else if (action === "unread") await markHeaderFlags(db, ids, { seen: false });
  else if (action === "flag") await markHeaderFlags(db, ids, { flagged: true });
  else await markHeaderFlags(db, ids, { flagged: false });
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

/**
 * Send a message. Attachments go up as multipart/form-data, are read into
 * memory on the server and handed straight to SMTP — never persisted there.
 * On success a full copy (including each attachment Blob) is written to the
 * local sent box so it can be read again and deleted to reclaim space.
 */
export async function sendEmailMessage(
  db: EmailDatabase,
  payload: EmailDraftPayload,
  files: File[] = [],
  account?: EmailAccount
): Promise<{ messageId: string }> {
  let body: BodyInit;
  if (files.length) {
    const form = new FormData();
    form.set("payload", JSON.stringify(payload));
    for (const file of files) form.append("attachments", file, file.name);
    body = form;
  } else {
    body = JSON.stringify(payload);
  }
  const result = await apiFetch<{ messageId: string }>("/api/crm/email/send", {
    method: "POST",
    body,
  });

  const attachmentRows = files.map((file, index) => ({
    id: `${index}:${file.name}:${file.size}`,
    filename: file.name,
    contentType: file.type || "application/octet-stream",
    blob: file,
    size: file.size,
  }));
  const bytes = new TextEncoder().encode(payload.text + payload.html).length +
    attachmentRows.reduce((sum, row) => sum + row.size, 0);
  const sent: SentMessage = {
    id: crypto.randomUUID(),
    accountId: payload.accountId,
    accountLabel: account?.label ?? "",
    from: account?.email ?? "",
    to: payload.to,
    cc: payload.cc,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
    date: new Date().toISOString(),
    messageId: result.messageId,
    inReplyTo: payload.inReplyTo,
    attachments: attachmentRows,
    bytes,
    logRecordId: payload.logRecordId,
    logRecordType: payload.logRecordType,
  };
  await saveSentMessage(db, sent).catch(() => undefined);
  return result;
}

export async function findCrmMatches(db: EmailDatabase, emails: string[]): Promise<CrmEmailMatch[]> {
  const unique = [...new Set(emails.map((entry) => entry.trim().toLowerCase()).filter(Boolean))].slice(0, 200);
  if (!unique.length) return [];
  const response = await apiFetch<{ matches: CrmEmailMatch[] }>(
    `/api/crm/email/matches?emails=${encodeURIComponent(unique.join(","))}`,
    { quiet: true }
  );
  await cacheContactMatches(db, response.matches);
  return response.matches;
}

export async function searchAccountHistory(
  db: EmailDatabase,
  account: EmailAccount,
  folder: string,
  address: string,
  limit = 100
): Promise<MailHeader[]> {
  const params = new URLSearchParams({ accountId: account.id, folder, q: address, limit: String(limit) });
  const response = await apiFetch<{ items: MailHeader[] }>(`/api/crm/email/search?${params}`, { quiet: true });
  await cacheSearchHeaders(db, account.id, folder, response.items);
  return response.items;
}
