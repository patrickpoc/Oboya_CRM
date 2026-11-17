import type { EmailPreset } from "./types";

/**
 * Server-owned presets. The browser reads these from `/api/crm/email/presets`
 * so provider settings can change without a client deploy.
 */
export const EMAIL_PRESETS: readonly EmailPreset[] = [
  {
    id: "263",
    labelKey: "providers.263",
    emailSuffix: "@oboya.cc",
    smtpHost: "smtp.263.net",
    smtpPort: 465,
    imapHost: "imap.263.net",
    imapPort: 993,
    secure: true,
  },
  {
    id: "simply",
    labelKey: "providers.simply",
    emailSuffix: "@oboya-horticulture.com",
    smtpHost: "smtp.simply.com",
    smtpPort: 465,
    imapHost: "imap.simply.com",
    imapPort: 993,
    secure: true,
  },
] as const;

export function getEmailPreset(id: string): EmailPreset | undefined {
  return EMAIL_PRESETS.find((entry) => entry.id === id);
}

/** Suggest a label from the local part of an address, e.g. sales@oboya.cc -> sales. */
export function suggestAccountLabel(email: string): string {
  const local = email.split("@")[0]?.trim();
  if (!local) return "Mailbox";
  return local.charAt(0).toUpperCase() + local.slice(1);
}
