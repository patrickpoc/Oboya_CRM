import type {
  CrmAction,
  CrmModule,
  CrmUser,
  PermissionLevel,
  PermissionOverrides,
  ResolvedPermissions,
} from "@/lib/crm/types";
import type { AccessMatrix } from "./access-types";
import { CRM_MODULES, FULL_ACTIONS, isCrmAction } from "./access-types";

function normalizeActions(level: PermissionLevel | unknown): CrmAction[] {
  if (level === "full") return [...FULL_ACTIONS];
  if (!Array.isArray(level)) return [];
  return level.filter(isCrmAction);
}

function roleActions(role: string, module: CrmModule, matrix: AccessMatrix): CrmAction[] {
  if (role === "super_admin") return [...FULL_ACTIONS];
  const row = matrix[role];
  if (!row) return []; // role not in the matrix: deny (as crm_has_permission)
  return normalizeActions(row[module]);
}

function overrideList(
  map: PermissionOverrides["grants"] | unknown,
  module: CrmModule
): CrmAction[] {
  if (!map || typeof map !== "object") return [];
  return normalizeActions((map as Record<string, unknown>)[module]);
}

/*
 * Pure resolvers: the matrix is always passed explicitly. Server code passes
 * the per-request `session.matrix`; client code uses ./matrix (hydrated snapshot).
 */

/** Sync check for a role against the given matrix. */
export function canAccess(
  role: string,
  module: CrmModule,
  action: CrmAction = "view",
  matrix: AccessMatrix
): boolean {
  return roleActions(role, module, matrix).includes(action);
}

/** Actions the user has on one module: role ∪ grants − denies (super_admin: all). */
export function userActions(
  user: Pick<CrmUser, "role" | "permissionOverrides"> | null | undefined,
  module: CrmModule,
  matrix: AccessMatrix
): CrmAction[] {
  if (!user) return [];
  if (user.role === "super_admin") return [...FULL_ACTIONS];
  const denies = overrideList(user.permissionOverrides?.denies, module);
  const allowed = new Set([
    ...roleActions(user.role, module, matrix),
    ...overrideList(user.permissionOverrides?.grants, module),
  ]);
  return FULL_ACTIONS.filter((a) => allowed.has(a) && !denies.includes(a));
}

/** Role ∪ grants − denies. Super Admin always has full access (overrides ignored). */
export function canAccessUser(
  user: Pick<CrmUser, "role" | "permissionOverrides"> | null | undefined,
  module: CrmModule,
  action: CrmAction = "view",
  matrix: AccessMatrix
): boolean {
  return userActions(user, module, matrix).includes(action);
}

/** Every module's allowed actions, for /api/crm/me and client-side UI gating. */
export function resolvePermissions(
  user: Pick<CrmUser, "role" | "permissionOverrides"> | null | undefined,
  matrix: AccessMatrix
): ResolvedPermissions {
  return Object.fromEntries(
    CRM_MODULES.map((m) => [m, userActions(user, m, matrix)])
  ) as ResolvedPermissions;
}
