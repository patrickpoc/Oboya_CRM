import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const client = vi.hoisted(() => ({
  connect: vi.fn(), list: vi.fn(), getMailboxLock: vi.fn(), logout: vi.fn(),
  fetch: vi.fn(), fetchOne: vi.fn(), download: vi.fn(),
  release: vi.fn(), mailbox: { uidNext: 2 },
}));
vi.mock("imapflow", () => ({ ImapFlow: vi.fn(function () { return client; }) }));

import { fetchAttachment, syncHeaders } from "../imap";
import type { EmailAccount } from "../types";

const config = { host: "imap.example.com", port: 993, secure: true, auth: { user: "sales", pass: "test" } };
const account = { id: "account-1" } as EmailAccount;

beforeEach(() => {
  vi.clearAllMocks();
  client.connect.mockResolvedValue(undefined);
  client.logout.mockResolvedValue(undefined);
  client.list.mockResolvedValue([{ path: "Sent Items", specialUse: "\\Sent" }]);
  client.getMailboxLock.mockResolvedValue({ release: client.release });
});

describe("IMAP headers", () => {
  it("reads original subject bytes, actual address fields, MIME filenames and the provider sent folder", async () => {
    client.fetch.mockImplementation(async function* () {
      yield {
        uid: 1, flags: new Set(["\\Seen"]),
        envelope: { subject: "broken envelope", from: [{ name: "Sales", address: "sales@example.com" }], to: [{ address: "buyer@example.com" }] },
        headers: Buffer.from("Subject: =?GBK?B?5Lit5paH?=\r\nIn-Reply-To: <previous@example.com>\r\nReferences: <root@example.com>\r\n\t<previous@example.com>\r\n\r\n"),
        bodyStructure: { type: "multipart/mixed", childNodes: [{ part: "2", type: "application/pdf", disposition: "attachment", dispositionParameters: { filename: "报价.pdf" } }] },
      };
    });
    const result = await syncHeaders(config, account, "Sent", undefined, 100);
    expect(client.getMailboxLock).toHaveBeenCalledWith("Sent Items");
    expect(result.items[0]).toMatchObject({ subject: "中文", folder: "Sent", from: [{ name: "Sales", address: "sales@example.com" }], hasAttachments: true });
    expect(result.items[0].to[0].address).toBe("buyer@example.com");
    expect(result.items[0].attachments[0].filename).toBe("报价.pdf");
    expect(result.items[0].inReplyTo).toBe("<previous@example.com>");
    expect(result.items[0].references).toEqual(["<root@example.com>", "<previous@example.com>"]);
    expect(client.logout).toHaveBeenCalledOnce();
  });
});

describe("attachment connection lifetime", () => {
  it("keeps IMAP open until a multi-chunk attachment finishes", async () => {
    const expected = Buffer.alloc(150_000, 7);
    client.download.mockResolvedValue({
      content: Readable.from((async function* () {
        for (let i = 0; i < expected.length; i += 64_000) {
          expect(client.logout).not.toHaveBeenCalled();
          yield expected.subarray(i, i + 64_000);
        }
      })()),
      meta: { filename: "large.bin", contentType: "application/octet-stream", expectedSize: 200_000 },
    });
    const result = await fetchAttachment(config, "INBOX", 1, "2");
    expect(client.release).not.toHaveBeenCalled();
    const chunks: Buffer[] = [];
    for await (const chunk of result!.content) chunks.push(chunk);
    expect(Buffer.concat(chunks)).toEqual(expected);
    expect(client.release).toHaveBeenCalledOnce();
    expect(client.logout).toHaveBeenCalledOnce();
  });

  it("also closes the connection when the caller cancels or setup fails", async () => {
    const stream = new Readable({ read() {} });
    client.download.mockResolvedValue({ content: stream, meta: {} });
    const result = await fetchAttachment(config, "INBOX", 1, "2");
    const closed = new Promise((resolve) => stream.once("close", resolve));
    result!.content.destroy();
    await closed;
    expect(client.logout).toHaveBeenCalledOnce();
    client.getMailboxLock.mockRejectedValueOnce(new Error("missing folder"));
    await expect(fetchAttachment(config, "INBOX", 1, "2")).rejects.toThrow("missing folder");
    expect(client.logout).toHaveBeenCalledTimes(2);
  });
});
