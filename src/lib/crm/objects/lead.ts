import { Trash2, UserRoundCog, UserRoundSearch } from "lucide-react";
import { applyLeadUpdateRules, isLeadConverted } from "@/lib/crm/leads/status";
import type { RecordConfig } from "./types";

/**
 * Leads (crm_leads). `sla` is virtual and computed (lib/crm/leads/sla-virtual).
 * `status` is edited only through the path (not inline). Status rules
 * (converted = read-only, Unqualified needs a reason, first_responded_at on
 * the first move out of New) run in `beforeUpdate`; `readOnly` mirrors the
 * converted lock in the UI. The Convert button is the page's `actionSlot`.
 * converted_* are written only by crm_convert_lead (POST /api/crm/leads/:id/convert).
 */
export const leadConfig: RecordConfig = {
  object: "lead",
  table: "crm_leads",
  module: "leads",
  namespace: "leads",
  basePath: "/leads",
  icon: UserRoundSearch,
  nameFields: ["full_name"],
  fields: [
    {
      key: "full_name",
      labelKey: "fields.name",
      type: "text",
      editable: false,
      hideInDetails: true,
      listable: true,
      sortable: true,
      searchable: true,
    },
    { key: "first_name", labelKey: "fields.firstName", type: "text", max: 100, searchable: true },
    { key: "last_name", labelKey: "fields.lastName", type: "text", max: 100, required: true, searchable: true },
    { key: "company", labelKey: "fields.company", type: "text", max: 200, listable: true, sortable: true, searchable: true },
    { key: "title", labelKey: "fields.title", type: "text", max: 120 },
    { key: "email", labelKey: "fields.email", type: "email", listable: true, searchable: true },
    { key: "phone", labelKey: "fields.phone", type: "phone", searchable: true },
    { key: "country_code", labelKey: "fields.country", type: "country", listable: true, sortable: true },
    { key: "entity_id", labelKey: "fields.entity", type: "entity", listable: true, filterable: true },
    {
      key: "status",
      labelKey: "fields.status",
      type: "picklist",
      required: true,
      defaultValue: "new",
      // Changed only through the lead path (LeadStatusPath), which handles the Unqualified reason.
      editable: false,
      creatable: true,
      picklist: {
        kind: "static",
        options: [
          { value: "new", labelKey: "statuses.new", tone: "brand" },
          { value: "working", labelKey: "statuses.working", tone: "info" },
          { value: "qualified", labelKey: "statuses.qualified", tone: "success" },
          { value: "unqualified", labelKey: "statuses.unqualified", tone: "danger" },
        ],
      },
      listable: true,
      sortable: true,
      filterable: true,
    },
    { key: "unqualified_reason", labelKey: "fields.unqualifiedReason", type: "text", max: 500, creatable: false, wide: true },
    {
      key: "sla",
      labelKey: "fields.sla",
      type: "picklist",
      virtual: true,
      editable: false,
      hideInDetails: true,
      listable: true,
      picklist: {
        kind: "static",
        options: [
          { value: "on_track", labelKey: "sla.on_track", tone: "success" },
          { value: "warning", labelKey: "sla.warning", tone: "warning" },
          { value: "overdue", labelKey: "sla.overdue", tone: "danger" },
        ],
      },
    },
    {
      key: "priority",
      labelKey: "fields.priority",
      type: "picklist",
      required: true,
      defaultValue: "normal",
      picklist: {
        kind: "static",
        options: [
          { value: "low", labelKey: "priorities.low", tone: "neutral" },
          { value: "normal", labelKey: "priorities.normal", tone: "muted" },
          { value: "high", labelKey: "priorities.high", tone: "warning" },
          { value: "urgent", labelKey: "priorities.urgent", tone: "danger" },
        ],
      },
      listable: true,
      sortable: true,
      filterable: true,
    },
    {
      key: "source",
      labelKey: "fields.source",
      type: "picklist",
      picklist: { kind: "picklist", picklist: "lead_source" },
      listable: true,
      sortable: true,
      filterable: true,
    },
    {
      key: "rating",
      labelKey: "fields.rating",
      type: "picklist",
      picklist: {
        kind: "static",
        options: [
          { value: "hot", labelKey: "ratings.hot", tone: "danger" },
          { value: "warm", labelKey: "ratings.warm", tone: "warning" },
          { value: "cold", labelKey: "ratings.cold", tone: "info" },
        ],
      },
      sortable: true,
    },
    {
      key: "tags",
      labelKey: "fields.tags",
      type: "tags",
      picklist: { kind: "picklist", picklist: "tag" },
      filterable: true,
      wide: true,
    },
    { key: "message", labelKey: "fields.message", type: "textarea", wide: true },
    { key: "owner_id", labelKey: "fields.owner", type: "owner", listable: true, filterable: true },
    {
      key: "created_at",
      labelKey: "fields.createdAt",
      type: "datetime",
      editable: false,
      listable: true,
      sortable: true,
      filterable: true,
    },
    { key: "first_responded_at", labelKey: "fields.firstRespondedAt", type: "datetime", editable: false, sortable: true },
    { key: "converted_at", labelKey: "fields.convertedAt", type: "datetime", editable: false },
    { key: "converted_account_id", labelKey: "fields.convertedAccount", type: "lookup", lookup: "account", editable: false },
    { key: "converted_contact_id", labelKey: "fields.convertedContact", type: "lookup", lookup: "contact", editable: false },
    {
      key: "converted_opportunity_id",
      labelKey: "fields.convertedOpportunity",
      type: "lookup",
      lookup: "opportunity",
      editable: false,
    },
    { key: "updated_at", labelKey: "fields.updatedAt", type: "datetime", editable: false, sortable: true },
  ],
  highlights: ["status", "sla", "priority", "source", "company"],
  listColumns: ["full_name", "company", "status", "sla", "priority", "source", "entity_id", "owner_id", "created_at"],
  defaultSort: { field: "created_at", dir: "desc" },
  path: {
    field: "status",
    source: "static",
    values: [
      { value: "new", labelKey: "statuses.new" },
      { value: "working", labelKey: "statuses.working" },
      { value: "qualified", labelKey: "statuses.qualified" },
    ],
  },
  relatedLists: [],
  actions: [
    { key: "changeOwner", labelKey: "changeOwner", permission: "edit", kind: "changeOwner", icon: UserRoundCog },
    { key: "delete", labelKey: "delete", permission: "delete", kind: "delete", icon: Trash2 },
  ],
  timeline: true,
  assignOnCreate: true,
  readOnly: (row) => isLeadConverted(row),
  beforeUpdate: (current, patch, now) => applyLeadUpdateRules(current, patch, now),
};
