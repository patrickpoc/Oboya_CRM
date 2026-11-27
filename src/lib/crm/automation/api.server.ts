import "server-only";

import { NextResponse } from "next/server";
import type { z } from "zod";
import { jsonError } from "@/lib/crm/setup/api.server";

/**
 * PATCH bodies: the patch schemas are `.partial()` of schemas with defaults, so
 * a parse would re-apply those defaults to absent fields. Only keys the client
 * actually sent are kept.
 */
export async function parsePatch<S extends z.ZodType>(
  request: Request,
  schema: S
): Promise<{ data: Partial<z.output<S>> } | NextResponse> {
  const raw = await request.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success || !raw || typeof raw !== "object" || Array.isArray(raw)) {
    const fields = parsed.success
      ? undefined
      : Object.fromEntries(parsed.error.issues.map((i) => [i.path.join(".") || "_", i.message]));
    return jsonError(400, "invalid_input", "Invalid input", { fields });
  }
  const sent = new Set(Object.keys(raw));
  const data = Object.fromEntries(
    Object.entries(parsed.data as Record<string, unknown>).filter(([k]) => sent.has(k))
  );
  return { data: data as Partial<z.output<S>> };
}

/** "unprocessable" reorder (ids do not match the stored set). */
export const invalidOrder = () =>
  jsonError(409, "invalid_order", "The list changed; reload and try again");
