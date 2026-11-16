/**
 * Stable business-rule codes raised by our RPCs/triggers (P0001 message) or by
 * `beforeUpdate`. Returned as the response `code`; the UI maps each one to
 * `record.errors.rules.<code>` and never shows server text.
 */
export const RULE_CODES = [
  "lead_converted",
  "reason_required",
  "loss_reason_required",
  "stage_unavailable",
  "one_primary_required",
] as const;
export type RuleCode = (typeof RULE_CODES)[number];

export function isRuleCode(value: unknown): value is RuleCode {
  return typeof value === "string" && (RULE_CODES as readonly string[]).includes(value);
}

/** Error codes returned by /api/crm/objects/** (the UI maps them to copy). */
export type ApiErrorCode =
  | "invalid"
  | "forbidden"
  | "not_found"
  | "duplicate"
  | "rule"
  | RuleCode
  | "unavailable";

export type MappedError = { status: number; body: { error: string; code: ApiErrorCode } };

type PgLikeError = { code?: string; message?: string } | null | undefined;

/** 422 body for a rule failure: a known code, or the generic `rule` (server text is never returned). */
export function ruleError(message: string | undefined): MappedError {
  const code = (message ?? "").trim();
  if (isRuleCode(code)) return { status: 422, body: { error: code, code } };
  return { status: 422, body: { error: "Invalid value", code: "rule" } };
}

/**
 * Maps a Postgres/PostgREST error to a safe HTTP response. Raw details,
 * hints and constraint names are never returned.
 */
export function mapDbError(error: PgLikeError): MappedError {
  const code = error?.code ?? "";
  switch (code) {
    case "42501":
      return { status: 403, body: { error: "Forbidden", code: "forbidden" } };
    case "23505":
      return { status: 409, body: { error: "Duplicate record", code: "duplicate" } };
    case "23514":
    case "P0001":
      return ruleError(error?.message);
    case "23503":
      return { status: 422, body: { error: "Related record not found", code: "rule" } };
    case "23502":
    case "22P02":
    case "22001":
    case "22023":
      return { status: 400, body: { error: "Invalid input", code: "invalid" } };
    case "P0002":
    case "PGRST116":
      return { status: 404, body: { error: "Not found", code: "not_found" } };
    default:
      return { status: 500, body: { error: "Request failed", code: "unavailable" } };
  }
}

/** Thrown by the repository; carries the original Postgres error for mapping. */
export class RepositoryError extends Error {
  constructor(
    readonly pg: { code?: string; message?: string },
    context: string
  ) {
    super(`${context}: ${pg.code ?? ""} ${pg.message ?? ""}`.trim());
    this.name = "RepositoryError";
  }
}
