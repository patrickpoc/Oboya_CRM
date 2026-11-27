import type { CrmAction, CrmModule, PermissionLevel } from "@/lib/crm/types";
import type { AccessMatrix } from "./access-types";
import { CRM_MODULES, FULL_ACTIONS } from "./access-types";

const FULL: PermissionLevel = "full";
const NONE: PermissionLevel = "none";
const VIEW: CrmAction[] = ["view"];
const READ_EXPORT: CrmAction[] = ["view", "export"];

function row(
  fill: PermissionLevel,
  cells: Partial<Record<CrmModule, PermissionLevel>> = {}
): Record<CrmModule, PermissionLevel> {
  return Object.fromEntries(
    CRM_MODULES.map((m) => [m, cells[m] ?? fill])
  ) as Record<CrmModule, PermissionLevel>;
}

export const BUILTIN_ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  sales_manager: "Sales Manager",
  sales_rep: "Sales Rep",
  read_only: "Read Only",
};

/**
 * Built-in matrix: fallback when crm_access_control has no row for a role.
 * Mirrors the seed of the access-control migration (crm_has_permission in SQL).
 */
export const BUILTIN_MATRIX: AccessMatrix = {
  super_admin: row(FULL),
  sales_manager: row(NONE, {
    home: FULL,
    reports: FULL,
    automation: VIEW,
    leads: FULL,
    accounts: FULL,
    contacts: FULL,
    opportunities: FULL,
    activities: FULL,
    cases: FULL,
    email: ["view", "create", "edit", "delete"],
    industry_news: ["view", "create", "edit"],
    audit_logs: VIEW,
  }),
  sales_rep: row(NONE, {
    home: VIEW,
    reports: ["view", "create", "edit", "delete", "export"],
    leads: ["view", "create", "edit", "convert", "export"],
    accounts: ["view", "create", "edit", "export"],
    contacts: ["view", "create", "edit", "export"],
    opportunities: ["view", "create", "edit", "export"],
    activities: ["view", "create", "edit", "delete"],
    cases: ["view", "create", "edit", "delete"],
    email: ["view", "create", "edit", "delete"],
    industry_news: VIEW,
  }),
  read_only: row(NONE, {
    home: VIEW,
    reports: READ_EXPORT,
    leads: READ_EXPORT,
    accounts: READ_EXPORT,
    contacts: READ_EXPORT,
    opportunities: READ_EXPORT,
    activities: READ_EXPORT,
    cases: READ_EXPORT,
    email: VIEW,
    industry_news: VIEW,
  }),
};

export function getBuiltinRoleLabel(roleId: string): string {
  return BUILTIN_ROLE_LABELS[roleId] ?? roleId;
}

export function buildDefaultMatrix(): AccessMatrix {
  return structuredClone(BUILTIN_MATRIX);
}

export { FULL_ACTIONS };
