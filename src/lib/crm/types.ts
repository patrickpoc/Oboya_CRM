import type { Locale } from "@/i18n/routing";

export const CRM_MODULES = [
  "home",
  "leads",
  "accounts",
  "contacts",
  "opportunities",
  "activities",
  "setup_users",
  "setup_roles",
  "setup_access",
  "setup_companies",
  "setup_pipeline",
  "setup_picklists",
  "setup_lead_assignment",
  "audit_logs",
] as const;
export type CrmModule = (typeof CRM_MODULES)[number];

export const CRM_ACTIONS = ["view", "create", "edit", "delete", "convert", "export"] as const;
export type CrmAction = (typeof CRM_ACTIONS)[number];

export const SYSTEM_ROLE_IDS = ["super_admin", "sales_manager", "sales_rep", "read_only"] as const;
export type CrmSystemRole = (typeof SYSTEM_ROLE_IDS)[number];

/** A matrix cell: every action, no action, or an explicit list. */
export type PermissionLevel = "full" | "none" | CrmAction[];

/** Per-user exceptions (crm_users.permission_overrides): role ∪ grants − denies. */
export type PermissionOverrides = {
  grants?: Partial<Record<CrmModule, PermissionLevel>>;
  denies?: Partial<Record<CrmModule, PermissionLevel>>;
};

export type VisibilityScope = "own" | "team" | "all";
export type CrmLocale = Locale;

export type CrmUser = {
  id: string;
  email: string;
  fullName: string;
  role: string;
  roleLabel: string;
  visibilityScope: VisibilityScope;
  canWrite: boolean;
  teamId: string | null;
  locale: CrmLocale;
  permissionOverrides: PermissionOverrides;
  mustChangePassword: boolean;
};

export type ResolvedPermissions = Record<CrmModule, CrmAction[]>;
