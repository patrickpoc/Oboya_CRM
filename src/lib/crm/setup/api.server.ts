import "server-only";

import { NextResponse } from "next/server";
import type { z } from "zod";
import { isRuleCode, type RuleCode } from "@/lib/crm/objects/errors";
import { stageDbErrorCode } from "./stages";

/** Shared helpers for the /api/crm setup handlers. */

export function jsonError(status: number, code: string, error?: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: error ?? code, code, ...extra }, { status });
}

export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S
): Promise<{ data: z.output<S> } | NextResponse> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const fields = Object.fromEntries(
      parsed.error.issues.map((issue) => [issue.path.join(".") || "_", issue.message])
    );
    return jsonError(400, "invalid_input", "Invalid input", { fields });
  }
  return { data: parsed.data };
}

type PgError = { code?: string; message?: string; details?: string | null } | null | undefined;

/**
 * Maps a PostgREST / Postgres error to a response. Server text is never
 * returned: 42501 is a fixed "Forbidden", and 23514 / 22023 / P0001 only pass
 * our own stable codes (stage invariants, rule codes from the RPCs).
 */
export function dbErrorResponse(error: PgError, context: string) {
  const code = error?.code ?? "";
  const message = error?.message ?? "";
  if (code === "42501") return jsonError(403, "forbidden", "Forbidden");
  if (code === "23505") return jsonError(409, "duplicate", "Already exists");
  if (code === "23503") return jsonError(409, "in_use", "Still referenced by other records");
  if (code === "23514" || code === "22023" || code === "P0001") {
    const stageCode = stageDbErrorCode(message);
    if (stageCode !== "unknown") {
      return jsonError(409, `stage_${stageCode}`, `stage_${stageCode}`, { invariant: true });
    }
    return jsonError(409, "constraint", safeRuleMessage(message) ?? "Invalid change", { invariant: true });
  }
  if (code === "P0002") return jsonError(404, "not_found", "Not found");
  if (code === "22P02" || code === "23502") return jsonError(400, "invalid_input", "Invalid input");
  console.error(`${context} failed:`, code, message);
  return jsonError(500, "failed", `${context} failed`);
}

/** Our own rule code (exact match), else null: never echoes other server text. */
export function safeRuleMessage(message: string | null | undefined): RuleCode | null {
  const trimmed = (message ?? "").trim();
  return isRuleCode(trimmed) ? trimmed : null;
}

/** Next 16 route context: `params` is a promise. */
export type IdParams = { params: Promise<{ id: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
