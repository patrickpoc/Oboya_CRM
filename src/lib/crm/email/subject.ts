import "server-only";

import { simpleParser } from "mailparser";

const utf8 = new TextDecoder("utf-8", { fatal: true });

function validUtf8(bytes: Buffer): boolean {
  try {
    utf8.decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function wordBytes(encoding: string, value: string): Buffer {
  if (encoding.toLowerCase() === "b") return Buffer.from(value, "base64");
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] === "=" && /^[a-f\d]{2}$/i.test(value.slice(i + 1, i + 3))) {
      bytes.push(parseInt(value.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(value[i] === "_" ? 32 : value.charCodeAt(i));
    }
  }
  return Buffer.from(bytes);
}

/** Some senders label UTF-8 header bytes as GBK. Prefer UTF-8 only when it is valid. */
function correctCharset(value: string): string {
  const word = "=\\?(?:gb[-_]?2312|gbk|gb[-_]?18030|cp936|windows-936)\\?([bq])\\?([^?]*)\\?=";
  return value.replace(new RegExp(`${word}(?:[ \\t]*${word})*`, "gi"), (group) => {
    const bytes = Buffer.concat([...group.matchAll(new RegExp(word, "gi"))].map((match) => wordBytes(match[1], match[2])));
    // Do not reinterpret genuine GBK characters whose bytes happen to be valid UTF-8 symbols.
    return validUtf8(bytes) && /\p{Script=Han}/u.test(bytes.toString("utf8"))
      ? `=?UTF-8?B?${bytes.toString("base64")}?=`
      : group;
  });
}

/** Decode the original header before it loses bytes in an IMAP ENVELOPE conversion. */
export async function decodeMailSubject(headers: Buffer | undefined, fallback = ""): Promise<string> {
  const raw = headers?.toString("latin1").match(/^subject:[ \t]*([^\r\n]*(?:\r?\n[ \t]+[^\r\n]*)*)/im)?.[1];
  if (raw === undefined && !/=\?[^?]+\?[bq]\?/i.test(fallback)) return fallback;

  let value = raw === undefined ? fallback : raw.replace(/\r?\n[ \t]+/g, " ");
  if (raw !== undefined) {
    const bytes = Buffer.from(value, "latin1");
    // Unencoded 8-bit headers occur in older Chinese mailboxes too.
    value = validUtf8(bytes) ? bytes.toString("utf8") : new TextDecoder("gb18030").decode(bytes);
  }
  const corrected = correctCharset(value);
  try {
    const parsed = await simpleParser(Buffer.from(`Subject: ${corrected}\r\n\r\n`, "utf8"));
    return parsed.subject ?? fallback;
  } catch {
    return fallback;
  }
}
