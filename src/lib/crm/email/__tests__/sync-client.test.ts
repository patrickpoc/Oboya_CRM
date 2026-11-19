import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailDatabase, SentMessage } from "../local-db";
import type { EmailAccount } from "../types";
import { MAIL_HEADER_VERSION } from "../types";
import { mergeSentHeaders, sentMessageHeader } from "../sent";

const mocks = vi.hoisted(() => ({
  api: vi.fn(), getSent: vi.fn(), cachedBody: vi.fn(), cachedState: vi.fn(),
  cacheBody: vi.fn(), cacheHeaders: vi.fn(), deleteSent: vi.fn(), removeHeaders: vi.fn(),
}));
vi.mock("@/components/crm/common/api", () => ({ apiFetch: mocks.api }));
vi.mock("../local-db", () => ({
  emailDb: () => ({ sent: { get: mocks.getSent } }),
  cachedBody: mocks.cachedBody, cachedSyncState: mocks.cachedState,
  cacheBody: mocks.cacheBody, cacheHeaders: mocks.cacheHeaders,
  deleteSentMessage: mocks.deleteSent, removeCachedHeaders: mocks.removeHeaders,
  markHeaderFlags: vi.fn(),
}));

const db = { sent: { get: mocks.getSent } } as unknown as EmailDatabase;

import { applyMailAction, loadAttachmentBlob, loadMailBody, syncMailboxes } from "../sync-client";

const message: SentMessage = {
  id: "local", accountId: "account-1", accountLabel: "Sales", from: "sales@example.com", to: ["buyer@example.com"], cc: [],
  subject: "报价", text: "正文", html: "", date: "2026-11-19T10:00:00Z", messageId: "<id>", bytes: 3,
  attachments: [{ id: "pdf", filename: "quote.pdf", contentType: "application/pdf", size: 3, blob: new Blob(["pdf"]) }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSent.mockResolvedValue(message);
  mocks.cachedBody.mockResolvedValue(undefined);
  mocks.api.mockResolvedValue({ items: [], nextUid: 43 });
  mocks.cacheHeaders.mockResolvedValue(0);
});

describe("local copies in the unified sent folder", () => {
  it("reads bodies and attachment Blobs locally without a mail bridge request", async () => {
    const header = sentMessageHeader(message);
    expect(await loadMailBody(db, header)).toMatchObject({ text: "正文", subject: "报价" });
    expect(await loadAttachmentBlob(db, header, "local:pdf", "quote.pdf", "application/pdf")).toBe(message.attachments[0].blob);
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it("deletes a local-only message without submitting UID 0 to IMAP", async () => {
    await applyMailAction(db, [sentMessageHeader(message)], "delete");
    expect(mocks.api).not.toHaveBeenCalled();
    expect(mocks.deleteSent).toHaveBeenCalledWith(db, "local");
  });

  it("deletes both copies when a message also has a server UID", async () => {
    const server = { ...sentMessageHeader(message), uid: 42, id: "server", localSentId: undefined };
    const [header] = mergeSentHeaders([server], [message], "account-1");
    await applyMailAction(db, [header], "delete");
    expect(mocks.api).toHaveBeenCalledWith("/api/crm/email/flags", expect.objectContaining({ body: expect.stringContaining('"uid":42') }));
    expect(mocks.deleteSent).toHaveBeenCalledWith(db, "local");
  });
});

describe("refreshing legacy header encodings", () => {
  const account = { id: "account-1", enabled: true } as EmailAccount;

  it("refetches the recent window once instead of keeping the old UID cursor and garbled subjects", async () => {
    mocks.cachedState.mockResolvedValue({ lastUid: 40 });
    await syncMailboxes(db, [account], ["INBOX"]);
    const url = new URL(mocks.api.mock.calls[0][0], "http://localhost");
    expect(url.searchParams.has("sinceUid")).toBe(false);
    expect(url.searchParams.get("limit")).toBe("200");
  });

  it("uses incremental sync again after headers have been refreshed", async () => {
    mocks.cachedState.mockResolvedValue({ lastUid: 40, headerVersion: MAIL_HEADER_VERSION });
    await syncMailboxes(db, [account], ["Sent"]);
    const url = new URL(mocks.api.mock.calls[0][0], "http://localhost");
    expect(url.searchParams.get("sinceUid")).toBe("40");
  });

  it("refetches a legacy cached body so opening an old message can recover its subject", async () => {
    mocks.cachedBody.mockResolvedValue({ text: "legacy" });
    mocks.api.mockResolvedValue({ subject: "正确标题", text: "正文" });
    const header = { ...sentMessageHeader(message), uid: 42, localSentId: undefined };
    expect(await loadMailBody(db, header)).toMatchObject({ subject: "正确标题" });
    expect(mocks.cacheBody).toHaveBeenCalledWith(db, expect.objectContaining({ subject: "正确标题" }));
  });
});
