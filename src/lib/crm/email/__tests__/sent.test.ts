import { describe, expect, it } from "vitest";
import type { SentMessage } from "../local-db";
import type { MailHeader } from "../types";
import { mergeSentHeaders, sentMessageBody, sentMessageHeader } from "../sent";

function local(patch: Partial<SentMessage> = {}): SentMessage {
  return {
    id: "local-1", accountId: "account-1", accountLabel: "Sales", from: "sales@example.com",
    to: ["buyer@example.com"], cc: [], subject: "报价", text: "报价正文", html: "",
    date: "2026-11-19T10:00:00Z", messageId: "<sent-1@example.com>",
    attachments: [{ id: "pdf", filename: "报价.pdf", contentType: "application/pdf", blob: new Blob(["pdf"]), size: 3 }],
    bytes: 3, ...patch,
  };
}

function remote(patch: Partial<MailHeader> = {}): MailHeader {
  return { ...sentMessageHeader(local()), id: "remote-1", uid: 42, localSentId: undefined, ...patch };
}

describe("unified sent mail", () => {
  it("deduplicates by account and Message-ID, retaining server actions and local attachments", () => {
    const message = local();
    const [merged] = mergeSentHeaders([remote()], [message], message.accountId);
    expect(merged).toMatchObject({ id: "remote-1", uid: 42, localSentId: message.id, subject: "报价" });
    expect(merged.attachments[0]).toMatchObject({ part: "local:pdf", filename: "报价.pdf" });
    expect(sentMessageBody(message, merged)).toMatchObject({ headerId: "remote-1", text: "报价正文" });
  });

  it("shows local-only and server-only messages in chronological order", () => {
    const server = remote({ messageId: "<server-only>", date: "2026-11-19T11:00:00Z" });
    const rows = mergeSentHeaders([server], [local()], "account-1");
    expect(rows.map((row) => row.id)).toEqual(["remote-1", "local-sent:local-1"]);
    expect(rows[1].uid).toBe(0);
  });

  it("scopes both sources to the active mailbox and customer, including cc", () => {
    const other = local({ id: "other", accountId: "account-2" });
    expect(mergeSentHeaders([remote({ accountId: "account-2" })], [other], "account-1")).toEqual([]);
    expect(mergeSentHeaders([remote()], [local()], "account-1", "unrelated@example.com")).toEqual([]);
    expect(mergeSentHeaders([], [local({ to: [], cc: ["BUYER@example.com"] })], "account-1", "buyer@example.com")).toHaveLength(1);
  });

  it("normalizes Message-ID brackets but never deduplicates by subject", () => {
    expect(mergeSentHeaders([remote({ messageId: "sent-1@example.com" })], [local()], "account-1")).toHaveLength(1);
    const noId = local({ id: "no-id", messageId: undefined });
    expect(mergeSentHeaders([remote({ messageId: undefined })], [noId, local()], "account-1")).toHaveLength(3);
  });

  it("keeps one row when duplicate local copies and duplicate server copies are present", () => {
    const rows = mergeSentHeaders([remote(), remote({ id: "duplicate" })], [local(), local({ id: "duplicate" })], "account-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].uid).toBe(42);
  });
});
