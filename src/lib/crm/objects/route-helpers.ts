import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";
import type { CrmAction } from "@/lib/crm/types";
import { crmGuard, type CrmGuardOk } from "@/lib/crm/server/require-crm-auth";
import { RepositoryError, mapDbError } from "./errors";
import { getRecordConfig } from "./registry";
import type { RecordConfig } from "./types";

export type ObjectRouteContext = { config: RecordConfig; guard: CrmGuardOk };

/**
 * Resolves `[object]` from the registry (404 when unknown), then
 * crmGuard(config.module, action). Returns a response on failure.
 */
export async function guardObject(
  object: string,
  action: CrmAction
): Promise<ObjectRouteContext | NextResponse> {
  const config = getRecordConfig(object);
  if (!config) return NextResponse.json({ error: "Not found", code: "not_found" }, { status: 404 });
  const guard = await crmGuard(config.module, action);
  if (guard instanceof NextResponse) return guard;
  return { config, guard };
}

export function isRecordId(id: string): boolean {
  return z.guid().safeParse(id).success;
}

export function notFound() {
  return NextResponse.json({ error: "Not found", code: "not_found" }, { status: 404 });
}

export function invalid(fields?: Record<string, string>) {
  return NextResponse.json({ error: "Invalid input", code: "invalid", fields }, { status: 400 });
}

/** Maps repository/Postgres errors to safe responses; logs the detail server-side. */
export function errorResponse(error: unknown, context: string) {
  if (error instanceof RepositoryError) {
    const mapped = mapDbError(error.pg);
    if (mapped.status >= 500) console.error(`[crm objects] ${context}:`, error.message);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
  console.error(`[crm objects] ${context}:`, error);
  return NextResponse.json({ error: "Request failed", code: "unavailable" }, { status: 500 });
}

export async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}
