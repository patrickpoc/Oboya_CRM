import type { CrmAction, CrmModule, PermissionLevel, PermissionOverrides } from "@/lib/crm/types";
import { CRM_ACTIONS, CRM_MODULES } from "@/lib/crm/types";
import type { AccessMatrix } from "@/lib/crm/permissions/access-types";
import { isCrmAction, isCrmModule, isValidRoleId } from "@/lib/crm/permissions/access-types";

/*
 * Matrix / override serialization for Setup -> Access and Setup -> Users.
 * DB shape (supabase/migrations/20261116000100_crm_core.sql):
 *   crm_access_control.matrix = { "<role>": { "<module>": "full" | "none" | ["view", ...] } }
 *   crm_users.permission_overrides = { grants: {<module>: level}, denies: {<module>: level} }
 */

/** Any level as an ordered action list ("full" = every action). */
export function levelToActions(level: PermissionLevel | unknown): CrmAction[] {
  if (level === "full") return [...CRM_ACTIONS];
  if (!Array.isArray(level)) return [];
  const set = new Set(level.filter(isCrmAction));
  return CRM_ACTIONS.filter((a) => set.has(a));
}

/** Canonical level: [] -> "none", every action -> "full", else ordered list. */
export function actionsToLevel(actions: readonly CrmAction[]): PermissionLevel {
  const ordered = levelToActions([...actions]);
  if (ordered.length === 0) return "none";
  if (ordered.length === CRM_ACTIONS.length) return "full";
  return ordered;
}

export function toggleAction(level: PermissionLevel | undefined, action: CrmAction): PermissionLevel {
  const current = levelToActions(level);
  return actionsToLevel(
    current.includes(action) ? current.filter((a) => a !== action) : [...current, action]
  );
}

/**
 * Matrix ready to save: one row per role in `roleIds` (valid ids only), every
 * module present with a canonical level; super_admin always "full".
 */
export function serializeMatrix(matrix: AccessMatrix, roleIds: readonly string[]): AccessMatrix {
  const out: AccessMatrix = {};
  for (const roleId of roleIds) {
    if (!isValidRoleId(roleId)) continue;
    const row = matrix[roleId] ?? {};
    out[roleId] = Object.fromEntries(
      CRM_MODULES.map((m) => [m, roleId === "super_admin" ? "full" : actionsToLevel(levelToActions(row[m]))])
    ) as Record<CrmModule, PermissionLevel>;
  }
  return out;
}

/** True when two matrices serialize to the same thing for the given roles. */
export function matrixEquals(a: AccessMatrix, b: AccessMatrix, roleIds: readonly string[]): boolean {
  return JSON.stringify(serializeMatrix(a, roleIds)) === JSON.stringify(serializeMatrix(b, roleIds));
}

type OverrideMap = Partial<Record<CrmModule, CrmAction[]>>;
export type NormalizedOverrides = { grants: OverrideMap; denies: OverrideMap };

function cleanMap(map: unknown): OverrideMap {
  if (!map || typeof map !== "object" || Array.isArray(map)) return {};
  const out: OverrideMap = {};
  for (const [mod, level] of Object.entries(map as Record<string, unknown>)) {
    if (!isCrmModule(mod)) continue;
    const actions = levelToActions(level);
    if (actions.length > 0) out[mod] = actions;
  }
  return out;
}

/**
 * Overrides ready to save: action lists only, empty modules dropped, and an
 * action both granted and denied stays denied only (denies win in SQL anyway).
 */
export function normalizeOverrides(raw: unknown): NormalizedOverrides {
  const source = raw && typeof raw === "object" ? (raw as PermissionOverrides) : {};
  const grants = cleanMap(source.grants);
  const denies = cleanMap(source.denies);
  for (const mod of Object.keys(grants) as CrmModule[]) {
    const denied = denies[mod] ?? [];
    const kept = (grants[mod] ?? []).filter((a) => !denied.includes(a));
    if (kept.length > 0) grants[mod] = kept;
    else delete grants[mod];
  }
  return { grants, denies };
}

export function countOverrides(overrides: PermissionOverrides | undefined): number {
  const { grants, denies } = normalizeOverrides(overrides);
  const count = (map: OverrideMap) => Object.values(map).reduce((sum, list) => sum + (list?.length ?? 0), 0);
  return count(grants) + count(denies);
}

export type OverrideCellState = "allowed" | "blocked" | "granted" | "denied";

export function overrideCellState(
  overrides: PermissionOverrides,
  roleLevel: PermissionLevel | undefined,
  module: CrmModule,
  action: CrmAction
): OverrideCellState {
  if (levelToActions(overrides.denies?.[module]).includes(action)) return "denied";
  if (levelToActions(overrides.grants?.[module]).includes(action)) return "granted";
  return levelToActions(roleLevel).includes(action) ? "allowed" : "blocked";
}

/** Click flips the role default; an override that equals the role default is dropped. */
export function toggleOverride(
  overrides: PermissionOverrides,
  roleLevel: PermissionLevel | undefined,
  module: CrmModule,
  action: CrmAction
): NormalizedOverrides {
  const state = overrideCellState(overrides, roleLevel, module, action);
  const { grants, denies } = normalizeOverrides(overrides);
  const drop = (map: OverrideMap) => {
    const list = (map[module] ?? []).filter((a) => a !== action);
    if (list.length > 0) map[module] = list;
    else delete map[module];
  };
  drop(grants);
  drop(denies);
  if (state === "allowed") denies[module] = levelToActions([...(denies[module] ?? []), action]);
  if (state === "blocked") grants[module] = levelToActions([...(grants[module] ?? []), action]);
  return { grants, denies };
}
