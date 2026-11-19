import "server-only";

import { ImapFlow, type FetchMessageObject, type FetchQueryObject, type MessageAddressObject, type MessageStructureObject } from "imapflow";
import { simpleParser } from "mailparser";
import type { Readable } from "node:stream";
import type { EmailAccount, EmailAttachmentMeta, EmailAddress, MailBody, MailHeader, MailSyncPage } from "./types";
import { nextUidAfterBatch, uidWindow } from "./uid-range";
import { MAIL_HEADER_VERSION } from "./types";
import { decodeMailSubject } from "./subject";
import { mailThread } from "./thread";

type ImapConfig = {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
};

function addresses(value?: MessageAddressObject[]): EmailAddress[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => ({
      name: entry.name ?? "",
      address: entry.address ?? "",
    }))
    .filter((entry) => entry.address.length > 0);
}

function attachmentMeta(node: MessageStructureObject | undefined): EmailAttachmentMeta[] {
  if (!node) return [];
  const out: EmailAttachmentMeta[] = [];
  const visit = (current: MessageStructureObject) => {
    const filename = current.dispositionParameters?.filename ?? current.parameters?.name;
    if (current.part && filename) {
      const disposition = (current.disposition ?? "attachment").toLowerCase();
      out.push({
        part: current.part,
        filename,
        contentType: current.type ?? "application/octet-stream",
        size: Number(current.size ?? 0),
        disposition: disposition === "inline" ? "inline" : "attachment",
      });
    }
    for (const child of current.childNodes ?? []) visit(child);
  };
  visit(node);
  return out;
}

function textParts(node: MessageStructureObject | undefined): { plain?: string; html?: string } {
  const found: { plain?: string; html?: string } = {};
  const visit = (current: MessageStructureObject) => {
    if (current.part && current.type === "text/plain" && !found.plain) found.plain = current.part;
    if (current.part && current.type === "text/html" && !found.html) found.html = current.part;
    for (const child of current.childNodes ?? []) visit(child);
  };
  if (node) visit(node);
  return found;
}

async function toHeader(account: EmailAccount, folder: string, message: FetchMessageObject): Promise<MailHeader | null> {
  if (!message.uid) return null;
  const flags = message.flags instanceof Set ? [...message.flags] : message.flags ?? [];
  const seen = flags.some((flag) => flag.toLowerCase().includes("seen"));
  const flagged = flags.some((flag) => flag.toLowerCase().includes("flagged"));
  const answered = flags.some((flag) => flag.toLowerCase().includes("answered"));
  const attachments = attachmentMeta(message.bodyStructure);
  const date = message.envelope?.date;
  return {
    id: `${account.id}:${folder}:${message.uid}`,
    accountId: account.id,
    folder,
    uid: message.uid,
    subject: await decodeMailSubject(message.headers, message.envelope?.subject ?? ""),
    headerVersion: MAIL_HEADER_VERSION,
    messageId: message.envelope?.messageId,
    ...mailThread(message.headers),
    from: addresses(message.envelope?.from),
    to: addresses(message.envelope?.to),
    cc: addresses(message.envelope?.cc),
    date: date ? new Date(date).toISOString() : new Date(0).toISOString(),
    seen,
    flagged,
    answered,
    hasAttachments: attachments.length > 0,
    attachments,
  };
}

async function openImap(config: ImapConfig, folder: string) {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.auth,
    logger: false,
    connectionTimeout: 10_000,
    socketTimeout: 30_000,
  });
  await client.connect();
  try {
    const specialUse = ({ Sent: "\\Sent", Drafts: "\\Drafts", Trash: "\\Trash" } as Record<string, string>)[folder];
    const path = specialUse ? (await client.list()).find((entry) => entry.specialUse === specialUse)?.path ?? folder : folder;
    const lock = await client.getMailboxLock(path);
    return { client, lock };
  } catch (error) {
    await client.logout().catch(() => undefined);
    throw error;
  }
}

async function withImap<T>(config: ImapConfig, folder: string, worker: (client: ImapFlow) => Promise<T>): Promise<T> {
  const { client, lock } = await openImap(config, folder);
  try {
    return await worker(client);
  } finally {
    try {
      lock.release();
    } finally {
      await client.logout().catch(() => undefined);
    }
  }
}

const HEADER_QUERY = {
  uid: true,
  envelope: true,
  flags: true,
  internalDate: true,
  bodyStructure: true,
  headers: ["subject", "in-reply-to", "references"],
} satisfies FetchQueryObject;

/** UID-cursor header sync. No OFFSET, no 1:* scan, bounded by `limit`. */
export async function syncHeaders(
  config: ImapConfig,
  account: EmailAccount,
  folder: string,
  sinceUid: number | undefined,
  limit: number
): Promise<MailSyncPage> {
  return withImap(config, folder, async (client) => {
    const max = Math.min(Math.max(limit, 1), 200);
    const mailbox = client.mailbox;
    const high = mailbox && "uidNext" in mailbox && mailbox.uidNext ? mailbox.uidNext - 1 : 0;
    const { range } = uidWindow(sinceUid, high, max);
    const items: MailHeader[] = [];

    for await (const message of client.fetch(range, HEADER_QUERY, { uid: true })) {
      const header = await toHeader(account, folder, message);
      if (header) items.push(header);
      if (items.length >= max) break;
    }

    items.sort((a, b) => b.uid - a.uid);
    return {
      items,
      nextUid: nextUidAfterBatch(items, sinceUid ?? (high > 0 ? high : null)),
      synced: items.length,
    };
  });
}

/** IMAP SEARCH for a contact address, then a narrow deferred header fetch. */
export async function searchHeaders(
  config: ImapConfig,
  account: EmailAccount,
  folder: string,
  address: string,
  limit: number
): Promise<MailHeader[]> {
  return withImap(config, folder, async (client) => {
    const found = await client.search(
      { or: [{ to: address }, { from: address }, { cc: address }] },
      { uid: true }
    );
    const uids = (Array.isArray(found) ? found : []).sort((a, b) => b - a).slice(0, Math.min(limit, 200));
    if (uids.length === 0) return [];
    const messages = await client.fetchAll(uids.join(","), HEADER_QUERY, { uid: true });
    return (await Promise.all(messages.map((message) => toHeader(account, folder, message))))
      .filter((item): item is MailHeader => Boolean(item));
  });
}

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/** Body parts only: attachments are never loaded here. */
export async function fetchBody(
  config: ImapConfig,
  accountId: string,
  folder: string,
  headerId: string,
  uid: number
): Promise<MailBody | null> {
  return withImap(config, folder, async (client) => {
    const one = await client.fetchOne(String(uid), { bodyStructure: true, envelope: true, headers: ["subject", "in-reply-to", "references"] }, { uid: true });
    if (!one) return null;
    const parts = textParts(one.bodyStructure);
    let text = "";
    let html = "";

    if (parts.plain) {
      const result = await client.download(String(uid), parts.plain, { uid: true, decodeText: true });
      if (result.content) text = await streamToString(result.content);
    }
    if (parts.html) {
      const result = await client.download(String(uid), parts.html, { uid: true, decodeText: true });
      if (result.content) html = await streamToString(result.content);
    }
    if (!parts.plain && !parts.html) {
      const parsed = await simpleParser(
        Buffer.concat(
          await (async () => {
            const result = await client.download(String(uid), undefined, { uid: true });
            const chunks: Buffer[] = [];
            if (result.content) {
              for await (const chunk of result.content) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
            }
            return chunks;
          })()
        )
      );
      text = parsed.text ?? "";
      html = typeof parsed.html === "string" ? parsed.html : "";
    }

    return {
      headerId,
      accountId,
      subject: await decodeMailSubject(one.headers, one.envelope?.subject ?? ""),
      ...mailThread(one.headers),
      text: text.slice(0, 200_000),
      html: html.slice(0, 600_000),
      attachments: attachmentMeta(one.bodyStructure),
    };
  });
}

export type AttachmentStream = {
  content: Readable;
  filename: string;
  contentType: string;
  size: number;
};

/** Streams one MIME part to the browser; nothing is persisted on the server. */
export async function fetchAttachment(
  config: ImapConfig,
  folder: string,
  uid: number,
  part: string
): Promise<AttachmentStream | null> {
  const { client, lock } = await openImap(config, folder);
  let closed = false;
  const cleanup = async () => {
    if (closed) return;
    closed = true;
    lock.release();
    await client.logout().catch(() => undefined);
  };
  try {
    const result = await client.download(String(uid), part, { uid: true });
    if (!result.content) {
      await cleanup();
      return null;
    }
    result.content.once("end", () => void cleanup());
    result.content.once("close", () => void cleanup());
    result.content.once("error", () => void cleanup());
    return {
      content: result.content,
      filename: result.meta.filename ?? part,
      contentType: result.meta.contentType ?? "application/octet-stream",
      size: Number(result.meta.expectedSize ?? 0),
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function setMailFlags(
  config: ImapConfig,
  folder: string,
  uid: number,
  action: "read" | "unread" | "flag" | "unflag" | "delete"
): Promise<void> {
  await withImap(config, folder, async (client) => {
    if (action === "read") await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
    else if (action === "unread") await client.messageFlagsRemove(String(uid), ["\\Seen"], { uid: true });
    else if (action === "flag") await client.messageFlagsAdd(String(uid), ["\\Flagged"], { uid: true });
    else if (action === "unflag") await client.messageFlagsRemove(String(uid), ["\\Flagged"], { uid: true });
    else {
      await client.messageDelete(String(uid), { uid: true });
    }
  });
}

export async function verifyImap(config: ImapConfig): Promise<void> {
  const client = new ImapFlow({ ...config, logger: false, connectionTimeout: 10_000 });
  await client.connect();
  await client.logout().catch(() => undefined);
}
