import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("server-only", () => ({}));

import { decryptSecret, encryptSecret, hasCredentialsKey } from "../credentials";
import { formatBytes, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_COUNT, MAX_TOTAL_ATTACHMENT_BYTES } from "../attachment-limits";
import { mapLimit } from "../map-limit";
import { EMAIL_PRESETS, getEmailPreset, suggestAccountLabel } from "../presets";
import { decodeAccountCursor, encodeAccountCursor } from "../rows";
import { emailAccountInputSchema, emailSendSchema, emailSyncQuerySchema } from "../schemas";
import { parseSendRequest } from "../send-payload";
import { nextUidAfterBatch, uidWindow } from "../uid-range";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("mailbox presets", () => {
  it("contains the two Oboya providers with the requested servers", () => {
    expect(EMAIL_PRESETS).toHaveLength(2);
    expect(getEmailPreset("263")).toMatchObject({
      emailSuffix: "@oboya.cc",
      smtpHost: "smtp.263.net",
      smtpPort: 465,
      imapHost: "imap.263.net",
      imapPort: 993,
      secure: true,
    });
    expect(getEmailPreset("simply")).toMatchObject({
      emailSuffix: "@oboya-horticulture.com",
      smtpHost: "smtp.simply.com",
      smtpPort: 465,
      imapHost: "mail.simply.com",
      imapPort: 993,
      secure: true,
    });
  });

  it("suggests a readable tag label from the local part", () => {
    expect(suggestAccountLabel("sales@oboya.cc")).toBe("Sales");
    expect(suggestAccountLabel("nope")).toBe("Nope");
  });
});

describe("credential encryption", () => {
  it("round-trips a password and never stores it verbatim", () => {
    vi.stubEnv("EMAIL_CREDENTIALS_KEY", Buffer.alloc(32, 7).toString("base64"));
    expect(hasCredentialsKey()).toBe(true);
    const encrypted = encryptSecret("app-password");
    expect(encrypted).toMatch(/^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
    expect(encrypted).not.toContain("app-password");
    expect(decryptSecret(encrypted)).toBe("app-password");
  });

  it("reports a missing or invalid key without throwing", () => {
    vi.stubEnv("EMAIL_CREDENTIALS_KEY", "");
    expect(hasCredentialsKey()).toBe(false);
    vi.stubEnv("EMAIL_CREDENTIALS_KEY", "short");
    expect(hasCredentialsKey()).toBe(false);
  });
});

describe("keyset helpers", () => {
  it("round-trips an account cursor and rejects malformed values", () => {
    const encoded = encodeAccountCursor({ created_at: "2026-11-17T10:00:00.000Z", id: "account-1" });
    expect(decodeAccountCursor(encoded)).toEqual({ createdAt: "2026-11-17T10:00:00.000Z", id: "account-1" });
    expect(decodeAccountCursor("not-a-cursor")).toBeNull();
  });

  it("bounds concurrency and preserves input order", async () => {
    let running = 0;
    let peak = 0;
    const result = await mapLimit([1, 2, 3, 4, 5], 2, async (value) => {
      running += 1;
      peak = Math.max(peak, running);
      await Promise.resolve();
      running -= 1;
      return value * 2;
    });
    expect(result).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBe(2);
  });
});

describe("UID cursor windows", () => {
  it("fetches the newest bounded window on first sync", () => {
    expect(uidWindow(null, 1000, 100)).toEqual({ range: "901:1000", nextUid: null });
    expect(uidWindow(940, 1000, 100)).toEqual({ range: "941:*", nextUid: 940 });
  });

  it("keeps the cursor at the highest fetched UID even when the batch is sparse", () => {
    expect(nextUidAfterBatch([{ uid: 942 }, { uid: 955 }, { uid: 950 }], 940)).toBe(955);
    expect(nextUidAfterBatch([], 940)).toBe(940);
  });
});

describe("email migration hardening", () => {
  const sql = fs.readFileSync(
    path.resolve(__dirname, "../../../../../supabase/migrations/20261117010000_crm_email.sql"),
    "utf8"
  );

  it("uses deferred joins, partial indexes and bounded retention", () => {
    expect(sql).toContain("with narrowed as");
    expect(sql).toContain("crm_email_contacts_email_idx");
    expect(sql).toContain("crm_email_accounts_deleted_idx");
    expect(sql).toContain("deleted_at < now() - interval '30 days'");
    expect(sql.toLowerCase()).not.toContain("offset ");
  });
});

describe("email API authorisation", () => {
  const root = path.resolve(__dirname, "../../../../../src/app/api/crm/email");
  const permissions: Record<string, string[]> = {
    "accounts/route.ts": ["view", "edit"],
    "accounts/[id]/route.ts": ["delete"],
    "attachment/route.ts": ["view"],
    "flags/route.ts": ["edit"],
    "matches/route.ts": ["view"],
    "message/route.ts": ["view"],
    "presets/route.ts": ["view"],
    "search/route.ts": ["view"],
    "send/route.ts": ["edit"],
    "sync/route.ts": ["edit"],
    "test/route.ts": ["edit"],
  };

  it("guards every route with the user-scoped CRM helper", () => {
    for (const [relative, expected] of Object.entries(permissions)) {
      const source = fs.readFileSync(path.join(root, ...relative.split("/")), "utf8");
      for (const action of expected) {
        expect(source).toContain(`crmGuard("email", "${action}")`);
      }
      expect(source).not.toContain("createServiceRoleClient");
      expect(source).not.toContain("supabaseAdmin");
    }
  });
});

describe("outgoing attachments", () => {
  const accountId = "11111111-1111-4111-8111-111111111111";
  const payload = { accountId, to: ["buyer@example.com"], subject: "Hi", text: "Hello" };

  function multipartRequest(files: { name: string; bytes: number; type?: string }[]): Request {
    const form = new FormData();
    form.set("payload", JSON.stringify(payload));
    for (const file of files) {
      form.append("attachments", new File([new Uint8Array(file.bytes)], file.name, {
        type: file.type ?? "application/octet-stream",
      }));
    }
    return new Request("http://localhost/api/crm/email/send", { method: "POST", body: form });
  }

  it("formats byte sizes for the UI", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });

  it("keeps the request body limit under the Vercel cap", () => {
    expect(MAX_TOTAL_ATTACHMENT_BYTES).toBeLessThan(4.5 * 1024 * 1024);
    expect(MAX_ATTACHMENT_BYTES).toBeLessThanOrEqual(MAX_TOTAL_ATTACHMENT_BYTES);
    expect(MAX_ATTACHMENT_COUNT).toBeGreaterThan(0);
  });

  it("parses JSON sends with no attachments", async () => {
    const request = new Request("http://localhost/api/crm/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const parsed = await parseSendRequest(request, emailSendSchema);
    expect(parsed).not.toBeInstanceOf(Response);
    if (parsed instanceof Response) return;
    expect(parsed.attachments).toHaveLength(0);
    expect(parsed.data.to).toEqual(["buyer@example.com"]);
  });

  it("reads multipart attachments into memory without persisting them", async () => {
    const parsed = await parseSendRequest(
      multipartRequest([{ name: "quote.pdf", bytes: 1024, type: "application/pdf" }]),
      emailSendSchema
    );
    expect(parsed).not.toBeInstanceOf(Response);
    if (parsed instanceof Response) return;
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0].filename).toBe("quote.pdf");
    expect(parsed.attachments[0].contentType).toBe("application/pdf");
    expect(parsed.attachments[0].content.byteLength).toBe(1024);
  });

  it("rejects an oversized single attachment and an oversized total", async () => {
    expect(await parseSendRequest(multipartRequest([{ name: "big.bin", bytes: MAX_ATTACHMENT_BYTES + 1 }]), emailSendSchema))
      .toBeInstanceOf(Response);
    const many = Array.from({ length: 3 }, (_, index) => ({
      name: `part-${index}.bin`,
      bytes: Math.floor(MAX_TOTAL_ATTACHMENT_BYTES / 2),
    }));
    expect(await parseSendRequest(multipartRequest(many), emailSendSchema)).toBeInstanceOf(Response);
  });

  it("rejects more attachments than the allowed count", async () => {
    const files = Array.from({ length: MAX_ATTACHMENT_COUNT + 1 }, (_, index) => ({
      name: `f-${index}.txt`,
      bytes: 8,
    }));
    expect(await parseSendRequest(multipartRequest(files), emailSendSchema)).toBeInstanceOf(Response);
  });
});

describe("mail API schemas", () => {
  const base = {
    label: "Sales",
    email: "sales@oboya.cc",
    provider: "263" as const,
    username: "sales@oboya.cc",
    password: "secret",
    smtpHost: "smtp.263.net",
    smtpPort: 465,
    imapHost: "imap.263.net",
    imapPort: 993,
  };

  it("coerces ports and applies secure defaults", () => {
    expect(emailAccountInputSchema.parse(base)).toMatchObject({
      smtpPort: 465,
      imapPort: 993,
      smtpSecure: true,
      imapSecure: true,
      color: "#004F7C",
      enabled: true,
    });
  });

  it("rejects invalid ports and oversized cursors", () => {
    expect(emailAccountInputSchema.safeParse({ ...base, smtpPort: 70000 }).success).toBe(false);
    expect(emailSyncQuerySchema.safeParse({ accountId: "not-a-uuid", folder: "INBOX" }).success).toBe(false);
  });

  it("requires at least one recipient when sending", () => {
    const accountId = "11111111-1111-4111-8111-111111111111";
    expect(emailSendSchema.safeParse({ accountId, to: [] }).success).toBe(false);
    expect(emailSendSchema.safeParse({ accountId, to: ["buyer@example.com"] }).success).toBe(true);
  });
});
