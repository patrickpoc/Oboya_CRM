import type { LucideIcon } from "lucide-react";
import type { z } from "zod";
import type { CrmAction, CrmModule } from "@/lib/crm/types";
import type { PillTone } from "@/components/crm/common/StatusPill";

/** Object names, as used by crm_recent_views, crm_soft_delete and the API path. */
export const CRM_OBJECTS = ["lead", "account", "contact", "opportunity", "activity", "case"] as const;
export type CrmObject = (typeof CRM_OBJECTS)[number];

export function isCrmObject(value: unknown): value is CrmObject {
  return typeof value === "string" && (CRM_OBJECTS as readonly string[]).includes(value);
}

export type FieldType =
  | "text"
  | "email"
  | "phone"
  | "url"
  | "textarea"
  | "number"
  | "currency"
  | "percent"
  | "date"
  | "datetime"
  | "picklist"
  | "multipicklist"
  | "tags"
  | "lookup"
  | "owner"
  | "entity"
  | "country"
  | "boolean";

/** Static option: the label is an i18n key relative to the object namespace. */
export type StaticOption = { value: string; labelKey: string; tone?: PillTone };

export type PicklistSource =
  | { kind: "static"; options: StaticOption[] }
  /** `crm_picklist_values.picklist` (labels come from the DB row). */
  | { kind: "picklist"; picklist: string }
  /** Active stages of the default pipeline (`lookups.stages`); values are stage ids. */
  | { kind: "stages" };

export interface FieldConfig {
  /** Column name, or a virtual key handled by a server handler (see `virtual`). */
  key: string;
  /** i18n key under the object namespace, e.g. "fields.name". */
  labelKey: string;
  type: FieldType;
  /** picklist / multipicklist / tags suggestions. */
  picklist?: PicklistSource;
  /** lookup target object. */
  lookup?: CrmObject;
  /** Polymorphic lookup: the target object is read from this column of the row (e.g. "what_object"). */
  lookupFrom?: string;
  /** entity: many-to-many with a primary flag (value = EntityLink[]). */
  multiple?: boolean;
  required?: boolean;
  /** Writable by create and PATCH (default true). Read-only columns: false. */
  editable?: boolean;
  /** Shown in the create form (default = editable). */
  creatable?: boolean;
  listable?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  searchable?: boolean;
  /** Not a column: loaded and saved by a handler in repositories/virtual-fields.ts. */
  virtual?: boolean;
  /** Hidden from the Details tab (still usable in lists/highlights). */
  hideInDetails?: boolean;
  /** Full-width cell in the Details grid. */
  wide?: boolean;
  /** Max length for text-like fields (default 255; textarea 10000). */
  max?: number;
  /** Currency fields: column holding the ISO currency (defaults to "USD"). */
  currencyField?: string;
  /** Initial value in the create form. */
  defaultValue?: unknown;
  /** Replaces the generated zod schema for this field (nullable handling still applies). */
  zod?: z.ZodType;
}

/** Value shape of an `entity` field with `multiple: true`. */
export type EntityLink = { entityId: string; isPrimary: boolean };

export interface PathConfig {
  field: string;
  /** static: `values` (or the field's static picklist); stages: crm_pipeline_stages. */
  source: "static" | "stages";
  values?: StaticOption[];
}

export interface RelatedListConfig {
  /** Unique key within the config (used for i18n and React keys). */
  key: string;
  object: CrmObject;
  /** Column on the related table pointing at this record. */
  foreignKey: string;
  /** Extra equality filters (polymorphic parents, e.g. { what_object: "account" }). */
  where?: Record<string, string>;
  /** Field keys of the related object (must exist in its config when registered). */
  columns: string[];
  /** i18n key under the *parent* object namespace. */
  labelKey: string;
}

export interface RecordActionConfig {
  key: string;
  /** i18n key under `record.actions` (built-ins) or the object namespace (custom). */
  labelKey: string;
  /** Required permission on config.module. */
  permission: CrmAction;
  /** Built-in header actions; object-specific buttons are passed as RecordPage `actionSlot`. */
  kind: "delete" | "changeOwner";
  icon?: LucideIcon;
}

export interface RecordConfig {
  object: CrmObject;
  table: string;
  module: CrmModule;
  /** next-intl namespace holding labels for this object (fields, options, title). */
  namespace: string;
  /** Base route of the list page, e.g. "/accounts". */
  basePath: string;
  icon: LucideIcon;
  /** Columns joined with a space to form the display name. */
  nameFields: string[];
  fields: FieldConfig[];
  highlights: string[];
  listColumns: string[];
  defaultSort: { field: string; dir: "asc" | "desc" };
  path?: PathConfig;
  relatedLists: RelatedListConfig[];
  actions: RecordActionConfig[];
  timeline: boolean;
  /**
   * Record-level read-only state (pure, client-safe), e.g. converted leads.
   * When true the record page disables inline edits and the path and hides
   * the built-in edit, change-owner and delete actions. The server enforces
   * the same rule independently (beforeUpdate / DB trigger).
   */
  readOnly?: (row: RecordRow) => boolean;
  /**
   * Optional server-side rule run by update() with the current row before
   * writing (pure, client-safe). Returns the patch to write, or `{ error }`
   * which becomes a 422 `rule` response.
   */
  beforeUpdate?: (
    current: RecordRow,
    patch: Record<string, unknown>,
    now: Date
  ) => { patch: Record<string, unknown> } | { error: string };
}

export type ListView = "mine" | "all" | "recent";
export type SortDir = "asc" | "desc";

/** A filter value: one value (eq) or several (in). */
export type ListFilters = Record<string, string[]>;

export interface ListQuery {
  view: ListView;
  q: string;
  filters: ListFilters;
  sort: string;
  dir: SortDir;
  /** 0-based */
  page: number;
  pageSize: number;
}

/** A record as returned by the API: columns + `_display` labels for references. */
export type RecordRow = {
  id: string;
  owner_id?: string;
  created_at?: string;
  updated_at?: string;
  _display?: Record<string, string>;
  [key: string]: unknown;
};

export type Option = { value: string; label: string };
export type UserOption = Option & { active: boolean };
export type StageOption = Option & { kind: "open" | "won" | "lost"; probability: number; color: string | null };

/** Serializable option lists loaded on the server for a page (see loadLookups). */
export interface RecordLookups {
  picklists: Record<string, Option[]>;
  users: UserOption[];
  entities: Option[];
  stages: StageOption[];
}

export interface RelatedListData {
  key: string;
  object: CrmObject;
  labelKey: string;
  foreignKey: string;
  where?: Record<string, string>;
  columns: string[];
  rows: RecordRow[];
  total: number;
}

/** Table, display column and route per object, usable before its config exists. */
export const OBJECT_META: Record<
  CrmObject,
  { table: string; nameColumn: string; basePath: string; module: CrmModule }
> = {
  lead: { table: "crm_leads", nameColumn: "full_name", basePath: "/leads", module: "leads" },
  account: { table: "crm_accounts", nameColumn: "name", basePath: "/accounts", module: "accounts" },
  contact: { table: "crm_contacts", nameColumn: "full_name", basePath: "/contacts", module: "contacts" },
  opportunity: {
    table: "crm_opportunities",
    nameColumn: "name",
    basePath: "/opportunities",
    module: "opportunities",
  },
  activity: { table: "crm_activities", nameColumn: "subject", basePath: "/activities", module: "activities" },
  case: { table: "crm_cases", nameColumn: "subject", basePath: "/cases", module: "cases" },
};

/** Query-string keys reserved by list views; field keys must not use them. */
export const RESERVED_QUERY_KEYS = ["view", "q", "sort", "dir", "page", "pageSize"] as const;

/** Target object of a lookup field for a row: static `lookup`, or polymorphic `lookupFrom`. */
export function lookupTarget(field: FieldConfig, row: Record<string, unknown>): CrmObject | null {
  if (field.lookup) return field.lookup;
  const value = field.lookupFrom ? row[field.lookupFrom] : null;
  return isCrmObject(value) ? value : null;
}
