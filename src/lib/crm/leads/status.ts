import { z } from "zod";
import type { RecordRow } from "@/lib/crm/objects/types";

export const LEAD_STATUSES = ["new", "working", "qualified", "unqualified"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

/** Linear path; `unqualified` is a terminal branch shown beside it. */
export const LEAD_PATH: readonly LeadStatus[] = ["new", "working", "qualified"];

/** Stable rule codes (lib/crm/objects/errors.ts RULE_CODES); the UI maps them to copy. */
export const LEAD_RULE_ERRORS = {
  converted: "lead_converted",
  reasonRequired: "reason_required",
} as const;

export function isLeadConverted(lead: Record<string, unknown>): boolean {
  return typeof lead.converted_at === "string" && lead.converted_at !== "";
}

function blank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

export type LeadUpdateResult = { patch: Record<string, unknown> } | { error: string };

/**
 * Server-side rules for lead updates (PATCH /api/crm/objects/lead/:id and
 * POST /api/crm/leads/:id/status; run by the
 * repository with the current row before writing):
 * - converted leads are read-only;
 * - moving to `unqualified` requires `unqualified_reason` (in the patch or already set);
 * - leaving `unqualified` clears the reason;
 * - the first move out of `new` stamps `first_responded_at` when it is null.
 */
export function applyLeadUpdateRules(
  current: Pick<RecordRow, string>,
  patch: Record<string, unknown>,
  now: Date = new Date()
): LeadUpdateResult {
  if (isLeadConverted(current)) return { error: LEAD_RULE_ERRORS.converted };
  const next = { ...patch };
  const status = typeof next.status === "string" ? next.status : undefined;
  const nextStatus = status ?? current.status;

  if (nextStatus === "unqualified") {
    const reason = "unqualified_reason" in next ? next.unqualified_reason : current.unqualified_reason;
    if (blank(reason)) return { error: LEAD_RULE_ERRORS.reasonRequired };
  } else if (status && !blank(current.unqualified_reason) && !("unqualified_reason" in next)) {
    next.unqualified_reason = null;
  }

  if (status && status !== "new" && status !== current.status && blank(current.first_responded_at)) {
    next.first_responded_at = now.toISOString();
  }
  return { patch: next };
}

/** Body of POST /api/crm/leads/:id/status (the path is the only status edit surface). */
export const leadStatusSchema = z
  .object({
    status: z.enum(LEAD_STATUSES),
    unqualifiedReason: z.string().trim().min(1).max(500).nullish(),
  })
  .strip();

export type LeadStatusInput = z.infer<typeof leadStatusSchema>;

/** Patch for the repository update (rules still run in applyLeadUpdateRules). */
export function leadStatusPatch(input: LeadStatusInput): Record<string, unknown> {
  const patch: Record<string, unknown> = { status: input.status };
  if (input.status === "unqualified" && input.unqualifiedReason) patch.unqualified_reason = input.unqualifiedReason;
  return patch;
}
