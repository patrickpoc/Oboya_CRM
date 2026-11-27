import "server-only";

import nodemailer from "nodemailer";
import type { EmailSendInput } from "./types";

type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
};

function transport(config: SmtpConfig) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    // Implicit TLS on 465; otherwise STARTTLS is mandatory so credentials never travel in clear text.
    requireTLS: !config.secure,
    auth: config.auth,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
  });
}

export async function verifySmtp(config: SmtpConfig): Promise<void> {
  await transport(config).verify();
}

export type MailAttachment = {
  filename: string;
  contentType: string;
  content: Buffer;
};

export async function sendMail(
  config: SmtpConfig,
  input: Pick<EmailSendInput, "to" | "cc" | "subject" | "text" | "html" | "inReplyTo">,
  attachments: MailAttachment[] = []
): Promise<{ messageId: string }> {
  const info = await transport(config).sendMail({
    from: config.auth.user,
    to: input.to.join(", "),
    cc: input.cc.length ? input.cc.join(", ") : undefined,
    subject: input.subject,
    text: input.text,
    html: input.html || undefined,
    inReplyTo: input.inReplyTo,
    attachments: attachments.length
      ? attachments.map((attachment) => ({
          filename: attachment.filename,
          contentType: attachment.contentType,
          content: attachment.content,
        }))
      : undefined,
  });
  return { messageId: info.messageId };
}
