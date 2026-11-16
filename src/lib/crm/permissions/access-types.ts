import type { CrmModule, PermissionLevel } from "@/lib/crm/types";
import { CRM_ACTIONS, CRM_MODULES, SYSTEM_ROLE_IDS } from "@/lib/crm/types";
import type { CrmAction, CrmSystemRole } from "@/lib/crm/types";

/** role id -> module -> level. Stored in crm_access_control.matrix. */
export type AccessMatrix = Record<string, Partial<Record<CrmModule, PermissionLevel>>>;

export { CRM_ACTIONS, CRM_MODULES };

export const FULL_ACTIONS: CrmAction[] = [...CRM_ACTIONS];

export const OBJECT_MODULES: CrmModule[] = [
  "leads",
  "accounts",
  "contacts",
  "opportunities",
  "activities",
];

export const SETUP_MODULES: CrmModule[] = CRM_MODULES.filter((m) => m.startsWith("setup_"));

export function isCrmModule(value: unknown): value is CrmModule {
  return typeof value === "string" && (CRM_MODULES as readonly string[]).includes(value);
}

export function isCrmAction(value: unknown): value is CrmAction {
  return typeof value === "string" && (CRM_ACTIONS as readonly string[]).includes(value);
}

export function isSystemRoleId(id: string): id is CrmSystemRole {
  return (SYSTEM_ROLE_IDS as readonly string[]).includes(id);
}

/** Same rule as the crm_roles.id check constraint. */
export function isValidRoleId(id: string): boolean {
  return /^[a-z][a-z0-9_]{1,39}$/.test(id);
}
