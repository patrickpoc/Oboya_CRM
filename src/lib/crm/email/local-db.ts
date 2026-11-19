"use client";

import Dexie, { type Table } from "dexie";
import type { CrmEmailMatch, EmailAccount, MailBody, MailHeader } from "./types";
import { MAIL_HEADER_VERSION } from "./types";

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
  headerVersion?: number;
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

export class EmailDatabase extends Dexie {
  accounts!: Table<EmailAccount, string>;
  headers!: Table<MailHeader, string>;
  bodies!: Table<MailBody, string>;
  attachments!: Table<AttachmentBlob, string>;
  templates!: Table<EmailTemplate, string>;
  drafts!: Table<OutboxDraft, string>;
  syncState!: Table<MailSyncState, string>;
  contacts!: Table<CachedContact, string>;
  sent!: Table<SentMessage, string>;

  constructor(userId: string) {
    super(`oboya-email:user:${userId}`);
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

const databases = new Map<string, EmailDatabase>();

/** Lazy so importing this module during SSR never touches IndexedDB. */
export function emailDb(userId: string): EmailDatabase {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error("A CRM user ID is required for local email storage");
  }
  let database = databases.get(userId);
  if (!database) {
    database = new EmailDatabase(userId);
    databases.set(userId, database);
  }
  return database;
}

/** Pending work retains a closed handle and cannot write into a later session. */
export function closeEmailDatabases(): void {
  for (const database of databases.values()) database.close({ disableAutoOpen: true });
  databases.clear();
}

// The legacy shared `oboya-email` database has no provable user ownership.
// Never open or import it into whichever account happens to sign in first.

export function headerKey(accountId: string, folder: string, uid: number): string {
  return `${accountId}:${folder}:${uid}`;
}

export function attachmentKey(headerId: string, part: string): string {
  return `${headerId}:${part}`;
}

export function syncKey(accountId: string, folder: string): string {
  return `${accountId}:${folder}`;
}

export async function cacheAccounts(db: EmailDatabase, accounts: EmailAccount[]): Promise<void> {
  await db.accounts.bulkPut(accounts);
}

export async function cachedAccounts(db: EmailDatabase): Promise<EmailAccount[]> {
  return db.accounts.orderBy("updatedAt").reverse().toArray();
}

export async function cacheHeaders(
  db: EmailDatabase,
  accountId: string,
  folder: string,
  items: MailHeader[],
  nextUid: number | null
): Promise<number> {
  await db.headers.bulkPut(items);
  await db.syncState.put({
    key: syncKey(accountId, folder),
    accountId,
    folder,
    lastUid: nextUid,
    lastSyncAt: new Date().toISOString(),
    headerVersion: MAIL_HEADER_VERSION,
  });
  return items.length;
}

/** Search results are cached as headers but must not reset the UID cursor. */
export async function cacheSearchHeaders(db: EmailDatabase, accountId: string, folder: string, items: MailHeader[]): Promise<number> {
  await db.headers.bulkPut(items);
  return items.length;
}

export async function cachedHeaders(db: EmailDatabase, accountId: string, folder: string, limit = 100): Promise<MailHeader[]> {
  const rows = await db
    .headers.where("[accountId+folder+date]")
    .between([accountId, folder, Dexie.minKey], [accountId, folder, Dexie.maxKey])
    .reverse()
    .limit(Math.min(Math.max(limit, 1), 500))
    .toArray();
  return rows;
}

export async function cachedSearch(db: EmailDatabase, accountId: string, folder: string, query: string, limit = 200): Promise<MailHeader[]> {
  const term = query.trim().toLowerCase();
  if (!term) return cachedHeaders(db, accountId, folder, limit);
  const rows = await db
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

export function cachedBody(db: EmailDatabase, headerId: string): Promise<MailBody | undefined> {
  return db.bodies.get(headerId);
}

export async function cacheBody(db: EmailDatabase, body: MailBody): Promise<void> {
  await db.bodies.put(body);
  if (body.subject !== undefined) {
    await db.headers.update(body.headerId, { subject: body.subject, inReplyTo: body.inReplyTo, references: body.references, headerVersion: MAIL_HEADER_VERSION });
  }
}

export function cachedAttachment(db: EmailDatabase, key: string): Promise<AttachmentBlob | undefined> {
  return db.attachments.get(key);
}

export async function cacheAttachment(db: EmailDatabase, entry: AttachmentBlob): Promise<void> {
  await db.attachments.put(entry);
}

export function cachedSyncState(db: EmailDatabase, accountId: string, folder: string): Promise<MailSyncState | undefined> {
  return db.syncState.get(syncKey(accountId, folder));
}

export async function markHeaderFlags(
  db: EmailDatabase,
  headerIds: string[],
  patch: Partial<Pick<MailHeader, "seen" | "flagged" | "answered">>
): Promise<void> {
  await db.transaction("rw", db.headers, async () => {
    const rows = await db.headers.bulkGet(headerIds);
    const updates = rows.filter((row): row is MailHeader => Boolean(row)).map((row) => ({ ...row, ...patch }));
    await db.headers.bulkPut(updates);
  });
}

export async function removeCachedHeaders(db: EmailDatabase, headerIds: string[]): Promise<void> {
  await db.transaction("rw", db.headers, db.bodies, db.attachments, async () => {
    await db.headers.bulkDelete(headerIds);
    await db.bodies.bulkDelete(headerIds);
    const attachmentKeys = await db.attachments.where("headerId").anyOf(headerIds).primaryKeys();
    await db.attachments.bulkDelete(attachmentKeys);
  });
}

export async function saveDraft(db: EmailDatabase, draft: OutboxDraft): Promise<void> {
  await db.drafts.put({ ...draft, updatedAt: new Date().toISOString(), synced: false });
}

export function listDrafts(db: EmailDatabase, accountId?: string): Promise<OutboxDraft[]> {
  const table = db.drafts;
  const query = accountId ? table.where("accountId").equals(accountId) : table.toCollection();
  return query.reverse().sortBy("updatedAt");
}

export async function deleteDraft(db: EmailDatabase, id: string): Promise<void> {
  await db.drafts.delete(id);
}

/** Total bytes held by the local sent box, used to show reclaimable space. */
export async function sentStorageBytes(db: EmailDatabase): Promise<number> {
  const rows = await db.sent.toArray();
  return rows.reduce((sum, row) => sum + row.bytes, 0);
}

export function listSent(db: EmailDatabase, accountId?: string): Promise<SentMessage[]> {
  const table = db.sent;
  const query = accountId ? table.where("accountId").equals(accountId) : table.toCollection();
  return query.reverse().sortBy("date");
}

export async function saveSentMessage(db: EmailDatabase, message: SentMessage): Promise<void> {
  await db.sent.put(message);
}

export async function deleteSentMessage(db: EmailDatabase, id: string): Promise<void> {
  await db.sent.delete(id);
}

export async function clearSentMessages(db: EmailDatabase, accountId?: string): Promise<void> {
  if (!accountId) {
    await db.sent.clear();
    return;
  }
  const keys = await db.sent.where("accountId").equals(accountId).primaryKeys();
  await db.sent.bulkDelete(keys);
}

export async function cacheContactMatches(db: EmailDatabase, matches: CrmEmailMatch[]): Promise<void> {
  const at = new Date().toISOString();
  await db.contacts.bulkPut(matches.map((entry) => ({ ...entry, cachedAt: at })));
}

export async function cachedContactMatch(db: EmailDatabase, email: string): Promise<CrmEmailMatch | undefined> {
  const normalized = email.trim().toLowerCase();
  const all = await db.contacts.toArray();
  return all.find((entry) => entry.email.trim().toLowerCase() === normalized);
}

export async function clearAccountCache(db: EmailDatabase, accountId: string): Promise<void> {
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
