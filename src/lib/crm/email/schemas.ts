import { z } from "zod";

const email = z.string().trim().email().max(320);

export const emailAccountInputSchema = z.object({
  id: z.string().uuid().optional(),
  label: z.string().trim().min(1).max(80),
  email,
  provider: z.enum(["263", "simply", "custom"]),
  username: z.string().trim().min(1).max(320),
  password: z.string().max(500).optional(),
  smtpHost: z.string().trim().min(1).max(253),
  smtpPort: z.coerce.number().int().min(1).max(65535),
  smtpSecure: z.boolean().default(true),
  imapHost: z.string().trim().min(1).max(253),
  imapPort: z.coerce.number().int().min(1).max(65535),
  imapSecure: z.boolean().default(true),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#2563eb"),
  enabled: z.boolean().default(true),
});

export type EmailAccountInput = z.infer<typeof emailAccountInputSchema>;

const accountId = z.string().uuid();
const uid = z.coerce.number().int().min(1);
const folder = z.enum(["INBOX", "Drafts", "Sent", "Trash"]);

export const emailAccountListQuerySchema = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const emailSyncQuerySchema = z.object({
  accountId,
  folder,
  sinceUid: uid.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const emailMessageQuerySchema = z.object({
  accountId,
  folder,
  uid,
});

export const emailAttachmentQuerySchema = emailMessageQuerySchema.extend({
  part: z.string().min(1).max(100),
});

export const emailFlagsSchema = z.object({
  accountId,
  folder,
  uid,
  action: z.enum(["read", "unread", "flag", "unflag", "delete"]),
});

export const emailSearchQuerySchema = z.object({
  accountId,
  folder: folder.default("Sent"),
  q: z.string().trim().min(1).max(320),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const emailMatchQuerySchema = z.object({
  emails: z.string().trim().min(1).max(2000),
});

export const emailSendSchema = z.object({
  accountId,
  to: z.array(email).min(1).max(50),
  cc: z.array(email).max(50).default([]),
  subject: z.string().max(300).default(""),
  text: z.string().max(100_000).default(""),
  html: z.string().max(300_000).default(""),
  inReplyTo: z.string().max(320).optional(),
  logRecordId: z.string().uuid().optional(),
  logRecordType: z.enum(["contact", "account"]).optional(),
});
