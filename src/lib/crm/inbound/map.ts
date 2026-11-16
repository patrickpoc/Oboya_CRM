import type { ContactPayload, InboundPayload, QuotePayload } from "./schema";

export const DEFAULT_ENTITY_ID = "00000000-0000-4000-8000-000000000201"; // Oboya Horticulture
export const IDEMPOTENCY_KEY_MAX = 200;

export type LeadInsert = {
  first_name: string | null;
  last_name: string;
  company: string | null;
  email: string;
  phone: string | null;
  country_code: string | null;
  locale: string | null;
  message: string;
  source: string;
  external_ref: string | null;
  raw_payload: InboundPayload;
};

export type ActivityNote = {
  subject: string;
  body: string;
  meta: Record<string, unknown>;
};

/**
 * Splits the RFQ `contactName` into first/last name.
 * Rule: whitespace is collapsed; the first word is the first name and the rest
 * is the last name ("Maria da Silva" -> "Maria" / "da Silva"). A single word
 * becomes the last name with no first name (last_name is required on contacts).
 */
export function splitContactName(full: string): { firstName: string | null; lastName: string } {
  const words = full.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return { firstName: null, lastName: "" };
  if (words.length === 1) return { firstName: null, lastName: words[0] };
  return { firstName: words[0], lastName: words.slice(1).join(" ") };
}

/** CRM country_code is ISO alpha-2; the website's "OTHER" maps to null. */
export function toCountryCode(code: string): string | null {
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

export function summarizeItems(items: QuotePayload["items"]): string {
  const lines = items.map((item) => {
    const label = item.name ? ` — ${item.name}` : "";
    const unit = item.unit ? ` ${item.unit}` : "";
    return `- ${item.sku} × ${item.quantity}${unit}${label}`;
  });
  return [`Items (${items.length}):`, ...lines].join("\n");
}

function contactMessage(payload: ContactPayload): string {
  return `${payload.subject} — ${payload.message}`;
}

function quoteMessage(payload: QuotePayload): string {
  const parts = [`RFQ ${payload.referenceId} · ${payload.currency}`];
  if (payload.message) parts.push(payload.message);
  parts.push(summarizeItems(payload.items));
  return parts.join("\n\n");
}

export function inboundSource(payload: InboundPayload): string {
  return payload.source ?? (payload.type === "contact" ? "website_contact" : "website_rfq");
}

/** Normalised key for a lookup: `<header key>` wins; a quote falls back to `rfq:<referenceId>`. */
export function deriveIdempotencyKeys(
  header: string | null | undefined,
  payload: InboundPayload
): { primary: string | null; header: string | null; all: string[] } {
  const raw = header?.trim() ?? "";
  const headerKey =
    raw && raw.length <= IDEMPOTENCY_KEY_MAX && /^[\x21-\x7e]+$/.test(raw) ? `idem:${raw}` : null;
  const rfqKey = payload.type === "quote" ? `rfq:${payload.referenceId}` : null;
  // Quotes always use rfq:<referenceId> as external_ref (stable across retries);
  // the header key is still matched against activity meta.
  const primary = rfqKey ?? headerKey;
  const all = [rfqKey, headerKey].filter((key): key is string => Boolean(key));
  return { primary, header: headerKey, all };
}

/** True when the header is present but unusable (too long or non-printable). */
export function isInvalidIdempotencyHeader(header: string | null | undefined): boolean {
  if (header === null || header === undefined) return false;
  const raw = header.trim();
  return !raw || raw.length > IDEMPOTENCY_KEY_MAX || !/^[\x21-\x7e]+$/.test(raw);
}

export function mapToLead(payload: InboundPayload, externalRef: string | null): LeadInsert {
  const base = {
    email: payload.email,
    locale: payload.locale ?? null,
    source: inboundSource(payload),
    external_ref: externalRef,
    raw_payload: payload,
  };
  if (payload.type === "contact") {
    return {
      ...base,
      first_name: payload.firstName,
      last_name: payload.lastName,
      company: payload.company ?? null,
      phone: payload.phone ?? null,
      country_code: toCountryCode(payload.countryCode),
      message: contactMessage(payload),
    };
  }
  const { firstName, lastName } = splitContactName(payload.contactName);
  return {
    ...base,
    first_name: firstName,
    last_name: lastName,
    company: payload.company,
    phone: payload.phone,
    country_code: toCountryCode(payload.countryCode),
    message: quoteMessage(payload),
  };
}

/** Note appended to an existing lead or converted contact on a repeat submission. */
export function mapToActivityNote(
  payload: InboundPayload,
  keys: { primary: string | null; header: string | null }
): ActivityNote {
  const who =
    payload.type === "contact" ? `${payload.firstName} ${payload.lastName}` : payload.contactName;
  const company = payload.company ? ` (${payload.company})` : "";
  const subject =
    payload.type === "contact"
      ? `Website contact: ${payload.subject}`
      : `Website RFQ ${payload.referenceId} (${payload.items.length} item${payload.items.length === 1 ? "" : "s"})`;
  const lines = [
    `${who}${company} <${payload.email}>`,
    payload.phone ? `Phone: ${payload.phone}` : null,
    `Country: ${payload.type === "contact" ? payload.countryName ?? payload.countryCode : payload.country ?? payload.countryCode}`,
    "",
    payload.type === "contact" ? contactMessage(payload) : quoteMessage(payload),
  ].filter((line): line is string => line !== null);
  return {
    subject: subject.slice(0, 300),
    body: lines.join("\n"),
    meta: {
      inbound: true,
      type: payload.type,
      source: inboundSource(payload),
      ...(payload.type === "quote" ? { referenceId: payload.referenceId } : {}),
      ...(keys.header ? { idempotencyKey: keys.header } : {}),
      ...(payload.locale ? { locale: payload.locale } : {}),
      ...(payload.submittedAt ? { submittedAt: payload.submittedAt } : {}),
    },
  };
}

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Resolves `entity` (id or slug of the name) among active group companies; undefined = unknown. */
export function resolveEntityId(
  ref: string | undefined,
  entities: Array<{ id: string; name: string }>
): string | undefined {
  if (!ref) return entities.find((e) => e.id === DEFAULT_ENTITY_ID)?.id ?? DEFAULT_ENTITY_ID;
  const needle = ref.toLowerCase();
  return entities.find((e) => e.id.toLowerCase() === needle || slugify(e.name) === needle)?.id;
}
