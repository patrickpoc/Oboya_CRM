import { z } from "zod";
import { EMAIL_ACCOUNT_COLORS } from "./colors";

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
  color: z.string().transform((value) => value.toUpperCase()).pipe(z.enum(EMAIL_ACCOUNT_COLORS)).default(EMAIL_ACCOUNT_COLORS[0]),
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

/** Accepts `Name <user@host>` as well as a bare address and keeps only the address. */
export function extractAddress(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const angle = value.match(/<([^<>]+)>\s*$/);
  return (angle ? angle[1] : value).trim();
}

const recipient = z.preprocess(extractAddress, email);
/** Clients may send null or "" for "not set"; treat both as absent. */
const absent = (value: unknown) => (value === null || value === "" ? undefined : value);

export const emailSendSchema = z.object({
  accountId,
  to: z.array(recipient).min(1).max(50),
  cc: z.preprocess(absent, z.array(recipient).max(50).default([])),
  subject: z.preprocess(absent, z.string().max(300).default("")),
  text: z.preprocess(absent, z.string().max(100_000).default("")),
  html: z.preprocess(absent, z.string().max(300_000).default("")),
  inReplyTo: z.preprocess(absent, z.string().max(998).optional()),
  logRecordId: z.preprocess(absent, z.string().uuid().optional()),
  logRecordType: z.preprocess(absent, z.enum(["contact", "account"]).optional()),
});
