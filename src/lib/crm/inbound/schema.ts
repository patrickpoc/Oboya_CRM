import { z } from "zod";

/**
 * Inbound payloads from the Oboya website. Field names and limits mirror
 * `_ref_oboya_website`: `src/app/api/cms/forms/route.ts` (contact) and
 * `src/app/api/shop/rfq/route.ts` (quote / RFQ). Unknown keys are stripped.
 */
export const CONTACT_LIMITS = {
  name: 80,
  phone: 32,
  company: 120,
  subject: 50,
  message: 500,
  countryName: 120,
} as const;

export const RFQ_LIMITS = {
  company: 120,
  contactName: 120,
  phone: 32,
  message: 500,
  country: 120,
  items: 50,
  quantity: 999_999,
} as const;

// Same rule as the website's isValidEmail().
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

const trimmed = (max: number) => z.string().trim().max(max);
const required = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  trimmed(max)
    .optional()
    .transform((value) => (value ? value : undefined));

const email = z
  .string()
  .trim()
  .max(254)
  .regex(EMAIL_RE);

const countryCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^([A-Z]{2}|OTHER)$/);

const common = {
  email,
  privacyAccepted: z.literal(true),
  marketingOptIn: z.boolean().optional(),
  locale: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/)
    .max(16)
    .optional(),
  submittedAt: z.iso.datetime({ offset: true }).optional(),
  /** Group company: crm_entities id or slug of its name (e.g. `oboya-horticultura`). */
  entity: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{1,64}$/i)
    .optional(),
  /** Overrides the lead source (lead_source picklist value). */
  source: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{1,40}$/)
    .optional(),
};

export const contactPayloadSchema = z.object({
  type: z.literal("contact"),
  firstName: required(CONTACT_LIMITS.name),
  lastName: required(CONTACT_LIMITS.name),
  phone: optionalText(CONTACT_LIMITS.phone),
  countryCode,
  countryName: optionalText(CONTACT_LIMITS.countryName),
  company: optionalText(CONTACT_LIMITS.company),
  subject: required(CONTACT_LIMITS.subject),
  message: required(CONTACT_LIMITS.message),
  ...common,
});

const rfqItemSchema = z
  .object({
    productId: optionalText(80),
    variantId: optionalText(80),
    variantName: optionalText(120),
    sku: required(80),
    name: optionalText(200),
    quantity: z.number().int().min(1).max(RFQ_LIMITS.quantity).optional(),
    /** Alias of `quantity` accepted for compatibility. */
    qty: z.number().int().min(1).max(RFQ_LIMITS.quantity).optional(),
    unit: optionalText(20),
    saleMode: optionalText(20),
    unitPrice: z.number().nonnegative().nullable().optional(),
    lineTotal: z.number().nonnegative().nullable().optional(),
  })
  .refine((item) => item.quantity !== undefined || item.qty !== undefined, {
    path: ["quantity"],
  })
  .transform(({ qty, ...item }) => ({ ...item, quantity: (item.quantity ?? qty) as number }));

export const quotePayloadSchema = z.object({
  type: z.literal("quote"),
  referenceId: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/),
  company: required(RFQ_LIMITS.company),
  contactName: required(RFQ_LIMITS.contactName),
  phone: required(RFQ_LIMITS.phone),
  country: optionalText(RFQ_LIMITS.country),
  countryCode,
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/),
  message: optionalText(RFQ_LIMITS.message),
  officeId: optionalText(80),
  items: z.array(rfqItemSchema).min(1).max(RFQ_LIMITS.items),
  total: z.number().nonnegative().nullable().optional(),
  pricing: optionalText(40),
  ...common,
});

export const inboundPayloadSchema = z.discriminatedUnion("type", [
  contactPayloadSchema,
  quotePayloadSchema,
]);

export type ContactPayload = z.infer<typeof contactPayloadSchema>;
export type QuotePayload = z.infer<typeof quotePayloadSchema>;
export type InboundPayload = z.infer<typeof inboundPayloadSchema>;

export type ParseResult =
  | { ok: true; data: InboundPayload }
  | { ok: false; issues: Array<{ path: string; code: string }> };

/** Validates a parsed JSON body. Errors carry field paths and codes only, never values. */
export function parseInboundPayload(input: unknown): ParseResult {
  const result = inboundPayloadSchema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const seen = new Set<string>();
  const issues: Array<{ path: string; code: string }> = [];
  for (const issue of result.error.issues) {
    const path = issue.path.map(String).join(".") || "(root)";
    const key = `${path}:${issue.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push({ path, code: issue.code });
  }
  return { ok: false, issues };
}
