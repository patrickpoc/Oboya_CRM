import "server-only";

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import type { EmailAccount, EmailAttachmentMeta, EmailAddress, MailBody, MailHeader, MailSyncPage } from "./types";
import { nextUidAfterBatch, uidWindow } from "./uid-range";

type ImapConfig = {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
};

type LooseAddress = { name?: string; mailbox?: string; host?: string };

type BodyNode = {
  type?: string;
  part?: string;
  filename?: string;
  disposition?: string;
  size?: number;
  childNodes?: BodyNode[];
};

type FetchMessage = {
  uid?: number;
  envelope?: {
    subject?: string;
    messageId?: string;
    from?: LooseAddress[] | false;
    to?: LooseAddress[] | false;
    cc?: LooseAddress[] | false;
    date?: Date | string;
  };
  flags?: Set<string> | string[];
  bodyStructure?: BodyNode;
};

function addresses(value?: LooseAddress[] | false): EmailAddress[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => ({
      name: entry.name ?? "",
      address: entry.mailbox && entry.host ? `${entry.mailbox}@${entry.host}` : entry.mailbox ?? "",
    }))
    .filter((entry) => entry.address.length > 0);
}

function attachmentMeta(node: BodyNode | undefined): EmailAttachmentMeta[] {
  if (!node) return [];
  const out: EmailAttachmentMeta[] = [];
  const visit = (current: BodyNode) => {
    if (current.part && current.filename) {
      const disposition = (current.disposition ?? "attachment").toLowerCase();
      out.push({
        part: current.part,
        filename: current.filename,
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

function textParts(node: BodyNode | undefined): { plain?: string; html?: string } {
  const found: { plain?: string; html?: string } = {};
  const visit = (current: BodyNode) => {
    if (current.part && current.type === "text/plain" && !found.plain) found.plain = current.part;
    if (current.part && current.type === "text/html" && !found.html) found.html = current.part;
    for (const child of current.childNodes ?? []) visit(child);
  };
  if (node) visit(node);
  return found;
}

function toHeader(account: EmailAccount, folder: string, message: FetchMessage): MailHeader | null {
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
    subject: message.envelope?.subject ?? "(no subject)",
    messageId: message.envelope?.messageId,
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

async function withImap<T>(config: ImapConfig, folder: string, worker: (client: ImapFlow) => Promise<T>): Promise<T> {
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
  const lock = await client.getMailboxLock(folder);
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
} as const;

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

    for await (const message of client.fetch(range, HEADER_QUERY, { uid: true }) as AsyncGenerator<FetchMessage>) {
      const header = toHeader(account, folder, message);
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
    const messages = (await client.fetchAll(uids.join(","), HEADER_QUERY, { uid: true })) as unknown as FetchMessage[];
    return messages.map((message) => toHeader(account, folder, message)).filter((item): item is MailHeader => Boolean(item));
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
    const one = (await client.fetchOne(String(uid), { bodyStructure: true }, { uid: true })) as FetchMessage | false;
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
      text: text.slice(0, 200_000),
      html: html.slice(0, 600_000),
      attachments: attachmentMeta(one.bodyStructure),
    };
  });
}

export type AttachmentStream = {
  content: NodeJS.ReadableStream;
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
  return withImap(config, folder, async (client) => {
    const result = await client.download(String(uid), part, { uid: true });
    if (!result.content) return null;
    return {
      content: result.content,
      filename: result.meta.filename ?? part,
      contentType: result.meta.contentType ?? "application/octet-stream",
      size: Number(result.meta.expectedSize ?? 0),
    };
  });
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
