export type EmailProviderId = "263" | "simply" | "custom";

export type EmailPreset = {
  id: Exclude<EmailProviderId, "custom">;
  labelKey: string;
  emailSuffix: string;
  smtpHost: string;
  smtpPort: number;
  imapHost: string;
  imapPort: number;
  secure: boolean;
};

export type EmailAccount = {
  id: string;
  label: string;
  email: string;
  provider: EmailProviderId;
  username: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  color: string;
  enabled: boolean;
  lastSyncAt: string | null;
  updatedAt: string;
};

export type EmailAddress = { name: string; address: string };

export type EmailAttachmentMeta = {
  part: string;
  filename: string;
  contentType: string;
  size: number;
  disposition: "attachment" | "inline";
};

export type MailFolder = "INBOX" | "Drafts" | "Sent" | "Trash";

/** Refresh legacy headers after fixing MIME subject/address decoding. */
export const MAIL_HEADER_VERSION = 3;

export type MailHeader = {
  id: string;
  accountId: string;
  folder: string;
  uid: number;
  subject: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  localSentId?: string;
  headerVersion?: number;
  from: EmailAddress[];
  to: EmailAddress[];
  cc: EmailAddress[];
  date: string;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  hasAttachments: boolean;
  attachments: EmailAttachmentMeta[];
};

export type MailBody = {
  headerId: string;
  accountId: string;
  subject?: string;
  inReplyTo?: string;
  references?: string[];
  text: string;
  html: string;
  attachments: EmailAttachmentMeta[];
};

export type MailSyncPage = {
  items: MailHeader[];
  nextUid: number | null;
  synced: number;
};

export type CrmEmailMatch = {
  id: string;
  recordType: "contact" | "account";
  fullName: string;
  email: string;
  accountId: string | null;
  accountName: string | null;
};

export type EmailSendInput = {
  accountId: string;
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  html: string;
  inReplyTo?: string;
  logRecordId?: string;
  logRecordType?: "contact" | "account";
};
