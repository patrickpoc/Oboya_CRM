import { z } from "zod";
import type { EntityLink, FieldConfig, RecordConfig } from "./types";

export type SchemaMode = "create" | "update";

const PICKLIST_VALUE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const PHONE = /^[+0-9()./\s-]{3,40}$/;

/** "" and whitespace-only strings mean "no value". */
function emptyToNull(value: unknown) {
  return typeof value === "string" && value.trim() === "" ? null : value;
}

function toNumber(value: unknown) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed.replace(",", "."));
    return Number.isFinite(n) ? n : value;
  }
  return value;
}

function normalizeTag(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : value;
}

const entityLinks = z
  .array(z.object({ entityId: z.guid(), isPrimary: z.boolean() }).strip())
  .max(20)
  // Non-empty lists need exactly one primary company (D5).
  .refine((links: EntityLink[]) => links.length === 0 || links.filter((l) => l.isPrimary).length === 1, {
    message: "one_primary_required",
  })
  .refine((links: EntityLink[]) => new Set(links.map((l) => l.entityId)).size === links.length, {
    message: "duplicate_entity",
  });

/** Base (non-null) schema of a field value, by type. */
export function baseFieldSchema(field: FieldConfig): z.ZodType {
  if (field.zod) return field.zod;
  const max = field.max ?? (field.type === "textarea" ? 10000 : 255);
  switch (field.type) {
    case "text":
      return z.string().trim().min(1).max(max);
    case "textarea":
      return z.string().trim().min(1).max(max);
    case "email":
      return z.string().trim().toLowerCase().pipe(z.email().max(max));
    case "phone":
      return z.string().trim().regex(PHONE);
    case "url":
      return z
        .string()
        .trim()
        .max(max)
        .transform((v) => (/^https?:\/\//i.test(v) ? v : `https://${v}`))
        .pipe(z.url({ protocol: /^https?$/ }));
    case "number":
      return z.preprocess(toNumber, z.number().finite());
    case "currency":
      return z.preprocess(
        toNumber,
        z.number().min(0).max(999_999_999_999.99).transform((n) => Math.round(n * 100) / 100)
      );
    case "percent":
      return z.preprocess(toNumber, z.number().int().min(0).max(100));
    case "date":
      return z.iso.date();
    case "datetime":
      return z.iso.datetime({ offset: true });
    case "picklist":
      if (field.picklist?.kind === "static") {
        const values = field.picklist.options.map((o) => o.value);
        return z.enum(values as [string, ...string[]]);
      }
      return z.string().regex(PICKLIST_VALUE);
    case "multipicklist":
      if (field.picklist?.kind === "static") {
        const values = field.picklist.options.map((o) => o.value);
        return z.array(z.enum(values as [string, ...string[]])).max(50);
      }
      return z.array(z.string().regex(PICKLIST_VALUE)).max(50);
    case "tags":
      // Same rules as crm_tags_valid (reference normalizeTags).
      return z
        .array(z.preprocess(normalizeTag, z.string().min(1).max(40)))
        .max(20)
        .transform((tags) => [...new Set(tags)]);
    case "lookup":
    case "owner":
      return z.guid();
    case "entity":
      return field.multiple ? entityLinks : z.guid();
    case "country":
      return z.preprocess(
        (v) => (typeof v === "string" ? v.trim().toUpperCase() : v),
        z.string().regex(/^[A-Z]{2}$/)
      );
    case "boolean":
      return z.boolean();
  }
}

function isArrayType(field: FieldConfig) {
  return (
    field.type === "multipicklist" ||
    field.type === "tags" ||
    (field.type === "entity" && field.multiple === true)
  );
}

/**
 * Schema of one field for a mode. Required fields reject null/""; optional
 * fields accept null ("" becomes null). Array fields default to [] (never null).
 */
export function fieldSchema(field: FieldConfig, mode: SchemaMode): z.ZodType {
  const base = baseFieldSchema(field);
  if (isArrayType(field)) {
    const arr = z.preprocess((v) => (v === null ? [] : v), base);
    return mode === "create" && field.required ? arr : arr.optional();
  }
  if (field.type === "boolean") {
    return mode === "create" && field.required ? base : base.optional();
  }
  const valued = field.required ? base : base.nullable();
  const withEmpty = z.preprocess(emptyToNull, valued);
  return mode === "create" && field.required ? withEmpty : withEmpty.optional();
}

/** Fields accepted by a mode: create uses `creatable ?? editable`, update uses `editable`. */
export function writableFields(config: RecordConfig, mode: SchemaMode): FieldConfig[] {
  return config.fields.filter((f) => {
    const editable = f.editable !== false;
    return mode === "create" ? (f.creatable ?? editable) : editable;
  });
}

/**
 * zod object generated from the config. Unknown keys are stripped (never
 * written). Update is partial and must change at least one field.
 */
export function buildSchema(config: RecordConfig, mode: SchemaMode) {
  const shape: Record<string, z.ZodType> = {};
  for (const field of writableFields(config, mode)) shape[field.key] = fieldSchema(field, mode);
  const object = z.object(shape).strip();
  if (mode === "create") return object;
  return object.refine((value) => Object.values(value).some((v) => v !== undefined), {
    message: "nothing_to_update",
  });
}

/** Flattens zod issues into { field: message } for the form. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "_");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
