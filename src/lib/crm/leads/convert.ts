import { z } from "zod";
import { mapDbError, type MappedError } from "@/lib/crm/objects/errors";

/**
 * Convert Lead: payload validation, mapping to crm_convert_lead(...) args,
 * result parsing and safe error mapping. Pure and client-safe (the dialog
 * shares the schema; the route calls the RPC with the user's JWT).
 */

export const CONVERT_CURRENCIES = ["BRL", "USD", "EUR", "CNY"] as const;
export type ConvertCurrency = (typeof CONVERT_CURRENCIES)[number];

const amount = z.preprocess(
  (v) => {
    if (typeof v === "string") {
      const t = v.trim();
      if (t === "") return null;
      const n = Number(t.replace(",", "."));
      return Number.isFinite(n) ? n : v;
    }
    return v;
  },
  z.number().min(0).max(999_999_999_999.99).transform((n) => Math.round(n * 100) / 100).nullable()
);

export const convertLeadSchema = z
  .object({
    account: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("new") }).strict(),
      z.object({ mode: z.literal("existing"), accountId: z.guid() }).strict(),
    ]),
    opportunity: z
      .object({
        name: z.string().trim().min(1).max(200),
        amount: amount.optional(),
        currency: z.enum(CONVERT_CURRENCIES).nullable().optional(),
        closeDate: z.iso.date().nullable().optional(),
      })
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

export type ConvertLeadInput = z.input<typeof convertLeadSchema>;
export type ConvertLeadPayload = z.output<typeof convertLeadSchema>;

export type ConvertRpcArgs = {
  p_lead_id: string;
  p_account_id: string | null;
  p_create_opportunity: boolean;
  p_opportunity_name: string | null;
  p_amount: number | null;
  p_currency: string | null;
  p_close_date: string | null;
};

export function toConvertRpcArgs(leadId: string, payload: ConvertLeadPayload): ConvertRpcArgs {
  const opp = payload.opportunity ?? null;
  return {
    p_lead_id: leadId,
    p_account_id: payload.account.mode === "existing" ? payload.account.accountId : null,
    p_create_opportunity: opp !== null,
    p_opportunity_name: opp?.name ?? null,
    p_amount: opp?.amount ?? null,
    p_currency: opp?.currency ?? null,
    p_close_date: opp?.closeDate ?? null,
  };
}

export type ConvertResult = {
  leadId: string;
  accountId: string;
  accountCreated: boolean;
  contactId: string;
  contactCreated: boolean;
  opportunityId: string | null;
};

const rpcResult = z.object({
  lead_id: z.guid(),
  account_id: z.guid(),
  account_created: z.boolean(),
  contact_id: z.guid(),
  contact_created: z.boolean(),
  opportunity_id: z.guid().nullable(),
});

/** Parses the jsonb returned by crm_convert_lead; null when it is malformed. */
export function parseConvertResult(data: unknown): ConvertResult | null {
  const parsed = rpcResult.safeParse(data);
  if (!parsed.success) return null;
  const r = parsed.data;
  return {
    leadId: r.lead_id,
    accountId: r.account_id,
    accountCreated: r.account_created,
    contactId: r.contact_id,
    contactCreated: r.contact_created,
    opportunityId: r.opportunity_id,
  };
}

/** Where to go after converting: the opportunity when created, else the account. */
export function convertTarget(result: Pick<ConvertResult, "accountId" | "opportunityId">): string {
  return result.opportunityId ? `/opportunities/${result.opportunityId}` : `/accounts/${result.accountId}`;
}

/** "<Company> – <YYYY-MM-DD>" (falls back to the lead name). */
export function defaultOpportunityName(company: string | null | undefined, fallback: string, date: Date): string {
  const base = (company ?? "").trim() || fallback.trim() || "Opportunity";
  return `${base} – ${date.toISOString().slice(0, 10)}`.slice(0, 200);
}

export type ConvertErrorCode =
  | "already_converted"
  | "account_not_found"
  | "no_open_stage"
  | "forbidden"
  | "not_found"
  | "duplicate"
  | "invalid"
  | "rule"
  | "unavailable";

export type ConvertMappedError = { status: number; body: { error: string; code: ConvertErrorCode } };

/** Safe mapping of crm_convert_lead errors (raw messages are never returned). */
export function mapConvertError(error: { code?: string; message?: string } | null | undefined): ConvertMappedError {
  const message = error?.message ?? "";
  if (/lead_already_converted/.test(message)) {
    return { status: 409, body: { error: "Lead already converted", code: "already_converted" } };
  }
  if (/account_not_found/.test(message)) {
    return { status: 404, body: { error: "Account not found", code: "account_not_found" } };
  }
  if (/no_open_stage/.test(message)) {
    return { status: 422, body: { error: "No open stage in the default pipeline", code: "no_open_stage" } };
  }
  const mapped: MappedError = mapDbError(error);
  if (mapped.status === 422) return { status: 422, body: { error: "Conversion rule failed", code: "rule" } };
  return mapped as ConvertMappedError;
}
