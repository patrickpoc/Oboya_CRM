/**
 * Attachment limits for outgoing mail.
 *
 * Kept under Vercel's 4.5 MB serverless request-body cap: a multipart upload
 * adds only small boundaries, so a 4 MB payload stays within the limit.
 * Attachments are streamed from the request straight to SMTP and are never
 * written to disk or to the database.
 */
export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const MAX_ATTACHMENT_COUNT = 10;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
