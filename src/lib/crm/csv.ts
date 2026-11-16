/**
 * CSV helpers. `csvCell` is ported from the reference
 * (`_ref_oboya_website/src/lib/cms/forms/crm.ts`), with one addition: text
 * starting with = + - @ (or a tab / CR) is prefixed with ' so spreadsheet apps
 * do not evaluate it as a formula (CSV injection). Numbers are left as is.
 */
export function csvCell(value: unknown): string {
  if (value == null) return "";
  let text = Array.isArray(value) ? value.join("|") : String(value);
  if (typeof value !== "number" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function csvRow(values: unknown[]): string {
  return values.map(csvCell).join(",");
}

/** Header + rows, newline-terminated, with a UTF-8 BOM so Excel detects the encoding. */
export function toCsv(header: string[], rows: unknown[][]): string {
  return `﻿${[csvRow(header), ...rows.map(csvRow)].join("\n")}\n`;
}
