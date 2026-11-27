import { NextResponse } from "next/server";
import type { z } from "zod";
import { jsonError } from "@/lib/crm/setup/api.server";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  MAX_TOTAL_ATTACHMENT_BYTES,
} from "./attachment-limits";
import type { MailAttachment } from "./smtp";
import type { EmailSendInput } from "./types";

/** Shape returned by the multipart parser: validated send fields plus in-memory attachments. */
export type ParsedSend = {
  data: EmailSendInput;
  attachments: MailAttachment[];
};

const MAX_ATTACHMENT_FILENAME = 200;

/**
 * Parse a send request that may be JSON (no attachments) or multipart/form-data.
 * The JSON field is named "payload"; files are appended under "attachments".
 * Files are read into memory only and handed to SMTP; nothing is persisted here.
 */
export async function parseSendRequest(
  request: Request,
  schema: z.ZodType<ParsedSend["data"]>
): Promise<ParsedSend | NextResponse> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    const raw = await request.json().catch(() => null);
    const parsed = schema.safeParse(raw);
    if (!parsed.success) return invalidFields(parsed.error);
    return { data: parsed.data, attachments: [] };
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, "invalid_input", "Invalid multipart body");
  }

  const rawPayload = form.get("payload");
  if (typeof rawPayload !== "string") return jsonError(400, "invalid_input", "Missing payload");
  const parsed = schema.safeParse(safeJson(rawPayload));
  if (!parsed.success) return invalidFields(parsed.error);

  const files = form.getAll("attachments").filter((entry): entry is File => entry instanceof File);
  if (files.length > MAX_ATTACHMENT_COUNT) {
    return jsonError(400, "invalid_input", `At most ${MAX_ATTACHMENT_COUNT} attachments are allowed`);
  }

  let total = 0;
  const attachments: MailAttachment[] = [];
  for (const file of files) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      return jsonError(400, "invalid_input", "An attachment exceeds the size limit");
    }
    total += file.size;
    if (total > MAX_TOTAL_ATTACHMENT_BYTES) {
      return jsonError(400, "invalid_input", "Attachments exceed the total size limit");
    }
    attachments.push({
      filename: file.name.slice(0, MAX_ATTACHMENT_FILENAME) || "attachment",
      contentType: file.type || "application/octet-stream",
      content: Buffer.from(await file.arrayBuffer()),
    });
  }

  return { data: parsed.data, attachments };
}

/** 400 naming the failing fields (paths only, never the submitted values). */
function invalidFields(error: z.ZodError): NextResponse {
  const fields = [...new Set(error.issues.map((issue) => String(issue.path[0] ?? "_")))];
  return jsonError(400, "invalid_input", `Invalid input: ${fields.join(", ")}`, { fields });
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
