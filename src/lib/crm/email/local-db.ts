"use client";

import Dexie, { type Table } from "dexie";
import type { CrmEmailMatch, EmailAccount, MailBody, MailHeader } from "./types";

export type AttachmentBlob = {
  key: string;
  headerId: string;
  part: string;
  filename: string;
  contentType: string;
  blob: Blob;
  cachedAt: string;
};

export type EmailTemplate = {
  id: string;
  name: string;
  subject: string;
  body: string;
  updatedAt: string;
};

export type OutboxDraft = {
  id: string;
  accountId: string;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  html: string;
  inReplyTo?: string;
  logRecordId?: string;
  logRecordType?: "contact" | "account";
  updatedAt: string;
  synced: boolean;
};

export type MailSyncState = {
  key: string;
  accountId: string;
  folder: string;
  lastUid: number | null;
  lastSyncAt: string;
  searchKey?: string;
};

/** A message sent from this browser. Everything, including attachments, lives only in IndexedDB. */
export type SentAttachment = {
  id: string;
  filename: string;
  contentType: string;
  blob: Blob;
  size: number;
};

export type SentMessage = {
  id: string;
  accountId: string;
  accountLabel: string;
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  html: string;
  date: string;
  messageId?: string;
  inReplyTo?: string;
  attachments: SentAttachment[];
  bytes: number;
  logRecordId?: string;
  logRecordType?: "contact" | "account";
};

type CachedContact = CrmEmailMatch & { cachedAt: string };

class EmailDatabase extends Dexie {
  accounts!: Table<EmailAccount, string>;
  headers!: Table<MailHeader, string>;
  bodies!: Table<MailBody, string>;
  attachments!: Table<AttachmentBlob, string>;
  templates!: Table<EmailTemplate, string>;
  drafts!: Table<OutboxDraft, string>;
  syncState!: Table<MailSyncState, string>;
  contacts!: Table<CachedContact, string>;
  sent!: Table<SentMessage, string>;

  constructor() {
    super("oboya-email");
    this.version(1).stores({
      accounts: "id, email, updatedAt",
      headers: "id, accountId, folder, uid, date, [accountId+folder+date], [accountId+folder+uid]",
      bodies: "headerId, accountId",
      attachments: "key, headerId, part",
      templates: "id, name, updatedAt",
      drafts: "id, accountId, updatedAt, synced",
      syncState: "key, accountId, folder, [accountId+folder]",
      contacts: "id, email, cachedAt",
    });
    this.version(2).stores({
      sent: "id, accountId, date, [accountId+date]",
    });
  }
}

let database: EmailDatabase | undefined;

/** Lazy so importing this module during SSR never touches IndexedDB. */
export function emailDb(): EmailDatabase {
  if (!database) database = new EmailDatabase();
  return database;
}

export function headerKey(accountId: string, folder: string, uid: number): string {
  return `${accountId}:${folder}:${uid}`;
}

export function attachmentKey(headerId: string, part: string): string {
  return `${headerId}:${part}`;
}

export function syncKey(accountId: string, folder: string): string {
  return `${accountId}:${folder}`;
}

export async function cacheAccounts(accounts: EmailAccount[]): Promise<void> {
  const db = emailDb();
  await db.accounts.bulkPut(accounts);
}

export async function cachedAccounts(): Promise<EmailAccount[]> {
  return emailDb().accounts.orderBy("updatedAt").reverse().toArray();
}

export async function cacheHeaders(
  accountId: string,
  folder: string,
  items: MailHeader[],
  nextUid: number | null
): Promise<number> {
  const db = emailDb();
  await db.headers.bulkPut(items);
  await db.syncState.put({
    key: syncKey(accountId, folder),
    accountId,
    folder,
    lastUid: nextUid,
    lastSyncAt: new Date().toISOString(),
  });
  return items.length;
}

/** Search results are cached as headers but must not reset the UID cursor. */
export async function cacheSearchHeaders(accountId: string, folder: string, items: MailHeader[]): Promise<number> {
  await emailDb().headers.bulkPut(items);
  return items.length;
}

export async function cachedHeaders(accountId: string, folder: string, limit = 100): Promise<MailHeader[]> {
  const rows = await emailDb()
    .headers.where("[accountId+folder+date]")
    .between([accountId, folder, Dexie.minKey], [accountId, folder, Dexie.maxKey])
    .reverse()
    .limit(Math.min(Math.max(limit, 1), 500))
    .toArray();
  return rows;
}

export async function cachedSearch(accountId: string, folder: string, query: string, limit = 200): Promise<MailHeader[]> {
  const term = query.trim().toLowerCase();
  if (!term) return cachedHeaders(accountId, folder, limit);
  const rows = await emailDb()
    .headers.where("[accountId+folder+date]")
    .between([accountId, folder, Dexie.minKey], [accountId, folder, Dexie.maxKey])
    .reverse()
    .limit(1000)
    .toArray();
  return rows
    .filter((item) =>
      [item.subject, item.from.map((address) => `${address.name} ${address.address}`).join(" "), item.to.map((address) => address.address).join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(term)
    )
    .slice(0, Math.min(limit, 200));
}

export function cachedBody(headerId: string): Promise<MailBody | undefined> {
  return emailDb().bodies.get(headerId);
}

export async function cacheBody(body: MailBody): Promise<void> {
  await emailDb().bodies.put(body);
}

export function cachedAttachment(key: string): Promise<AttachmentBlob | undefined> {
  return emailDb().attachments.get(key);
}

export async function cacheAttachment(entry: AttachmentBlob): Promise<void> {
  await emailDb().attachments.put(entry);
}

export function cachedSyncState(accountId: string, folder: string): Promise<MailSyncState | undefined> {
  return emailDb().syncState.get(syncKey(accountId, folder));
}

export async function markHeaderFlags(
  headerIds: string[],
  patch: Partial<Pick<MailHeader, "seen" | "flagged" | "answered">>
): Promise<void> {
  const db = emailDb();
  await db.transaction("rw", db.headers, async () => {
    const rows = await db.headers.bulkGet(headerIds);
    const updates = rows.filter((row): row is MailHeader => Boolean(row)).map((row) => ({ ...row, ...patch }));
    await db.headers.bulkPut(updates);
  });
}

export async function removeCachedHeaders(headerIds: string[]): Promise<void> {
  const db = emailDb();
  await db.transaction("rw", db.headers, db.bodies, db.attachments, async () => {
    await db.headers.bulkDelete(headerIds);
    await db.bodies.bulkDelete(headerIds);
    const attachmentKeys = await db.attachments.where("headerId").anyOf(headerIds).primaryKeys();
    await db.attachments.bulkDelete(attachmentKeys);
  });
}

export async function saveDraft(draft: OutboxDraft): Promise<void> {
  await emailDb().drafts.put({ ...draft, updatedAt: new Date().toISOString(), synced: false });
}

export function listDrafts(accountId?: string): Promise<OutboxDraft[]> {
  const table = emailDb().drafts;
  const query = accountId ? table.where("accountId").equals(accountId) : table.toCollection();
  return query.reverse().sortBy("updatedAt");
}

export async function deleteDraft(id: string): Promise<void> {
  await emailDb().drafts.delete(id);
}

/** Total bytes held by the local sent box, used to show reclaimable space. */
export async function sentStorageBytes(): Promise<number> {
  const rows = await emailDb().sent.toArray();
  return rows.reduce((sum, row) => sum + row.bytes, 0);
}

export function listSent(accountId?: string): Promise<SentMessage[]> {
  const table = emailDb().sent;
  const query = accountId ? table.where("accountId").equals(accountId) : table.toCollection();
  return query.reverse().sortBy("date");
}

export async function saveSentMessage(message: SentMessage): Promise<void> {
  await emailDb().sent.put(message);
}

export async function deleteSentMessage(id: string): Promise<void> {
  await emailDb().sent.delete(id);
}

export async function clearSentMessages(accountId?: string): Promise<void> {
  const db = emailDb();
  if (!accountId) {
    await db.sent.clear();
    return;
  }
  const keys = await db.sent.where("accountId").equals(accountId).primaryKeys();
  await db.sent.bulkDelete(keys);
}

export function defaultTemplates(): EmailTemplate[] {
  const now = new Date(0).toISOString();
  return [
    { id: "follow-up", name: "Follow up", subject: "Following up", body: "Hello,\n\nFollowing up on our conversation.\n\nBest regards", updatedAt: now },
    { id: "quotation", name: "Quotation", subject: "Quotation", body: "Hello,\n\nPlease find our quotation below.\n\nBest regards", updatedAt: now },
  ];
}

export async function ensureTemplates(): Promise<void> {
  const db = emailDb();
  if ((await db.templates.count()) === 0) await db.templates.bulkPut(defaultTemplates());
}

export async function cacheContactMatches(matches: CrmEmailMatch[]): Promise<void> {
  const db = emailDb();
  const at = new Date().toISOString();
  await db.contacts.bulkPut(matches.map((entry) => ({ ...entry, cachedAt: at })));
}

export async function cachedContactMatch(email: string): Promise<CrmEmailMatch | undefined> {
  const normalized = email.trim().toLowerCase();
  const all = await emailDb().contacts.toArray();
  return all.find((entry) => entry.email.trim().toLowerCase() === normalized);
}

export async function clearAccountCache(accountId: string): Promise<void> {
  const db = emailDb();
  const headers = await db.headers.where("accountId").equals(accountId).primaryKeys();
  const bodies = await db.bodies.where("accountId").equals(accountId).primaryKeys();
  const attachments = await db.attachments.where("headerId").anyOf(headers as string[]).primaryKeys();
  const states = await db.syncState.where("accountId").equals(accountId).primaryKeys();
  const drafts = await db.drafts.where("accountId").equals(accountId).primaryKeys();
  await db.transaction("rw", db.headers, db.bodies, db.attachments, db.syncState, db.drafts, async () => {
    await Promise.all([
      db.headers.bulkDelete(headers),
      db.bodies.bulkDelete(bodies),
      db.attachments.bulkDelete(attachments),
      db.syncState.bulkDelete(states),
      db.drafts.bulkDelete(drafts),
    ]);
  });
}

/** Bodies table has no accountId index in v1; keep the field for future migration. */
export function bodyBelongsTo(body: MailBody, accountId: string): boolean {
  return body.headerId.startsWith(`${accountId}:`);
}
