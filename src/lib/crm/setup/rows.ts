import type { PermissionOverrides, VisibilityScope } from "@/lib/crm/types";
import type { StageColorToken, StageKind } from "./stages";

/** API row shapes shared by the setup handlers and pages (camelCase). */

export type SetupUser = {
  id: string;
  email: string;
  fullName: string;
  title: string | null;
  phone: string | null;
  role: string;
  teamId: string | null;
  status: "active" | "disabled";
  locale: string;
  receivesInbound: boolean;
  permissionOverrides: PermissionOverrides;
  createdAt: string;
};

export type SetupRole = {
  id: string;
  label: string;
  description: string | null;
  system: boolean;
  visibilityScope: VisibilityScope;
  canWrite: boolean;
  sortOrder: number;
  active: boolean;
  userCount?: number;
};

export type SetupTeam = {
  id: string;
  name: string;
  description: string | null;
  managerId: string | null;
  active: boolean;
  memberCount?: number;
};

export type SetupEntity = {
  id: string;
  name: string;
  legalName: string | null;
  countryCode: string | null;
  taxId: string | null;
  defaultCurrency: "BRL" | "USD" | "EUR" | "CNY";
  active: boolean;
  sortOrder: number;
};

export type SetupPicklistValue = {
  id: string;
  picklist: string;
  value: string;
  label: string;
  sortOrder: number;
  active: boolean;
};

export type SetupAuditLog = {
  id: number;
  actorId: string | null;
  actorName: string;
  object: string;
  /** null for config rows keyed by text (roles, settings, access matrix). */
  recordId: string | null;
  recordKey: string | null;
  action: string;
  diff: Record<string, [unknown, unknown]>;
  createdAt: string;
};

export const USER_COLUMNS =
  "id, email, full_name, title, phone, role, team_id, status, locale, receives_inbound, permission_overrides, created_at";

type UserDbRow = {
  id: string;
  email: string;
  full_name: string;
  title: string | null;
  phone: string | null;
  role: string;
  team_id: string | null;
  status: string;
  locale: string;
  receives_inbound: boolean;
  permission_overrides: unknown;
  created_at: string;
};

export function toSetupUser(row: UserDbRow): SetupUser {
  const overrides = row.permission_overrides;
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    title: row.title,
    phone: row.phone,
    role: row.role,
    teamId: row.team_id,
    status: row.status === "active" ? "active" : "disabled",
    locale: row.locale,
    receivesInbound: row.receives_inbound,
    permissionOverrides:
      overrides && typeof overrides === "object" && !Array.isArray(overrides)
        ? (overrides as PermissionOverrides)
        : {},
    createdAt: row.created_at,
  };
}

export const ROLE_COLUMNS = "id, label, description, system, visibility_scope, can_write, sort_order, active";

export function toSetupRole(row: {
  id: string;
  label: string;
  description: string | null;
  system: boolean;
  visibility_scope: string;
  can_write: boolean;
  sort_order: number;
  active: boolean;
}): SetupRole {
  return {
    id: row.id,
    label: row.label,
    description: row.description,
    system: row.system,
    visibilityScope: row.visibility_scope === "all" || row.visibility_scope === "team" ? row.visibility_scope : "own",
    canWrite: row.can_write,
    sortOrder: row.sort_order,
    active: row.active,
  };
}

export const TEAM_COLUMNS = "id, name, description, manager_id, active";

export function toSetupTeam(row: {
  id: string;
  name: string;
  description: string | null;
  manager_id: string | null;
  active: boolean;
}): SetupTeam {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    managerId: row.manager_id,
    active: row.active,
  };
}

export const ENTITY_COLUMNS = "id, name, legal_name, country_code, tax_id, default_currency, active, sort_order";

export function toSetupEntity(row: {
  id: string;
  name: string;
  legal_name: string | null;
  country_code: string | null;
  tax_id: string | null;
  default_currency: string;
  active: boolean;
  sort_order: number;
}): SetupEntity {
  return {
    id: row.id,
    name: row.name,
    legalName: row.legal_name,
    countryCode: row.country_code,
    taxId: row.tax_id,
    defaultCurrency: row.default_currency as SetupEntity["defaultCurrency"],
    active: row.active,
    sortOrder: row.sort_order,
  };
}

export const STAGE_COLUMNS = "id, pipeline_id, label, probability, sort_order, color_token, kind, active";

export function toStageFields(row: {
  id: string;
  label: string;
  probability: number;
  sort_order: number;
  color_token: string | null;
  kind: string;
  active: boolean;
}) {
  return {
    id: row.id,
    label: row.label,
    probability: row.probability,
    sortOrder: row.sort_order,
    colorToken: row.color_token as StageColorToken | null,
    kind: row.kind as StageKind,
    active: row.active,
  };
}

export const PICKLIST_COLUMNS = "id, picklist, value, label, sort_order, active";

export function toSetupPicklistValue(row: {
  id: string;
  picklist: string;
  value: string;
  label: string;
  sort_order: number;
  active: boolean;
}): SetupPicklistValue {
  return {
    id: row.id,
    picklist: row.picklist,
    value: row.value,
    label: row.label,
    sortOrder: row.sort_order,
    active: row.active,
  };
}
