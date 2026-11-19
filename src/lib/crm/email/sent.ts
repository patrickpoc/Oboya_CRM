import type { SentMessage } from "./local-db";
import type { MailBody, MailHeader } from "./types";

function messageKey(accountId: string, messageId: string | undefined): string | null {
  const id = messageId?.trim().replace(/^<|>$/g, "");
  return id ? `${accountId}:${id}` : null;
}

export function sentMessageHeader(message: SentMessage): MailHeader {
  return {
    id: `local-sent:${message.id}`,
    accountId: message.accountId,
    folder: "Sent",
    uid: 0,
    localSentId: message.id,
    subject: message.subject,
    messageId: message.messageId,
    inReplyTo: message.inReplyTo,
    from: [{ name: "", address: message.from }],
    to: message.to.map((address) => ({ name: "", address })),
    cc: message.cc.map((address) => ({ name: "", address })),
    date: message.date,
    seen: true,
    flagged: false,
    answered: false,
    hasAttachments: message.attachments.length > 0,
    attachments: message.attachments.map((attachment) => ({
      part: `local:${attachment.id}`,
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: attachment.size,
      disposition: "attachment",
    })),
  };
}

/** Preserve the server UID for actions and the local body/Blobs for offline reading. */
export function mergeSentHeaders(
  remote: MailHeader[],
  local: SentMessage[],
  accountId: string,
  recipient?: string | null
): MailHeader[] {
  const address = recipient?.trim().toLowerCase();
  const matches = (addresses: string[]) => !address || addresses.some((entry) => entry.trim().toLowerCase() === address);
  const items = new Map<string, MailHeader>();
  for (const header of remote) {
    if (header.accountId !== accountId || header.folder !== "Sent") continue;
    if (!matches([...header.to, ...header.cc].map((entry) => entry.address))) continue;
    const key = messageKey(accountId, header.messageId) ?? header.id;
    if (!items.has(key)) items.set(key, header);
  }
  for (const message of local) {
    if (message.accountId !== accountId || !matches([...message.to, ...message.cc])) continue;
    const header = sentMessageHeader(message);
    const key = messageKey(accountId, message.messageId) ?? header.id;
    const existing = items.get(key);
    if (existing) {
      // The first local copy wins when more than one copy has the same Message-ID.
      if (!existing.localSentId) items.set(key, {
        ...existing,
        localSentId: message.id,
        hasAttachments: existing.hasAttachments || header.hasAttachments,
        attachments: header.attachments.length ? header.attachments : existing.attachments,
      });
    } else items.set(key, header);
  }
  return [...items.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export function sentMessageBody(message: SentMessage, header: MailHeader): MailBody {
  return {
    headerId: header.id,
    accountId: message.accountId,
    subject: header.subject,
    inReplyTo: message.inReplyTo,
    references: message.inReplyTo ? [message.inReplyTo] : [],
    text: message.text,
    html: message.html,
    attachments: header.attachments,
  };
}
