import type { PermissionLevel } from "@/lib/crm/types";
import type { AccessMatrix } from "./access-types";
import { CRM_MODULES, isCrmAction, isValidRoleId } from "./access-types";
import { buildDefaultMatrix } from "./defaults";

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** Unknown cells become "none" so one bad value cannot grant access. */
function parseCell(value: unknown): PermissionLevel {
  if (value === "full" || value === "none") return value;
  if (Array.isArray(value)) return [...new Set(value.filter(isCrmAction))];
  return "none";
}

/**
 * Parses crm_access_control.matrix, mirroring crm_has_permission() in
 * supabase/migrations/20261116000100_crm_core.sql (shape documented there):
 *   `{ "<role>": { "<module>": "full" | "none" | ["view", ...] } }`
 *
 * - `null` (no singleton row) means BUILTIN_MATRIX.
 * - A stored matrix is taken as is: a role without a row, a malformed row or a
 *   missing module has no permissions (same as SQL).
 * - super_admin is always full.
 * Throws when the value is not an object (caller fails closed).
 */
export function parseAccessMatrix(raw: unknown): AccessMatrix {
  if (raw == null) return buildDefaultMatrix();
  if (!isPlainObject(raw)) {
    throw new Error("crm_access_control.matrix is not an object");
  }

  const matrix: AccessMatrix = {};
  for (const [roleId, rowValue] of Object.entries(raw)) {
    if (!isValidRoleId(roleId)) continue;
    matrix[roleId] = Object.fromEntries(
      CRM_MODULES.map((m) => [m, isPlainObject(rowValue) ? parseCell(rowValue[m]) : "none"])
    );
  }
  matrix.super_admin = Object.fromEntries(CRM_MODULES.map((m) => [m, "full" as const]));
  return matrix;
}

/*
 * Client-side snapshot only (hydrated from /api/crm/me or a server prop).
 * Server code never writes this module state: concurrent requests would share
 * it. It passes the per-request `session.matrix` explicitly instead.
 */
type AccessSnapshot = { matrix: AccessMatrix; hydrated: boolean };

const snapshot: AccessSnapshot = { matrix: buildDefaultMatrix(), hydrated: false };

export function getAccessSnapshot(): AccessSnapshot {
  return { matrix: snapshot.matrix, hydrated: snapshot.hydrated };
}

export function hydrateAccessMatrix(matrix: AccessMatrix): void {
  if (typeof window === "undefined") {
    throw new Error("hydrateAccessMatrix is client-only; pass session.matrix on the server");
  }
  snapshot.matrix = matrix;
  snapshot.hydrated = true;
}

export function resetAccessMatrixToBuiltin(): void {
  snapshot.matrix = buildDefaultMatrix();
  snapshot.hydrated = false;
}
