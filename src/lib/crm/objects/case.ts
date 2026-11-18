import { LifeBuoy, Trash2, UserRoundCog } from "lucide-react";
import type { RecordConfig, StaticOption } from "./types";

export const CASE_TYPES: StaticOption[] = [
  { value: "question", labelKey: "types.question", tone: "info" },
  { value: "delivery", labelKey: "types.delivery", tone: "brand" },
  { value: "complaint", labelKey: "types.complaint", tone: "danger" },
  { value: "other", labelKey: "types.other", tone: "neutral" },
];

export const CASE_QUEUES: StaticOption[] = [
  { value: "support", labelKey: "queues.support", tone: "info" },
  { value: "logistics", labelKey: "queues.logistics", tone: "brand" },
  { value: "quality", labelKey: "queues.quality", tone: "highlight" },
  { value: "billing", labelKey: "queues.billing", tone: "warning" },
  { value: "escalation", labelKey: "queues.escalation", tone: "danger" },
];

export const CASE_PRIORITY_OPTIONS: StaticOption[] = [
  { value: "low", labelKey: "priorities.low", tone: "muted" },
  { value: "normal", labelKey: "priorities.normal", tone: "neutral" },
  { value: "high", labelKey: "priorities.high", tone: "warning" },
  { value: "urgent", labelKey: "priorities.urgent", tone: "danger" },
];

export const CASE_STATUS_OPTIONS: StaticOption[] = [
  { value: "new", labelKey: "statuses.new", tone: "info" },
  { value: "working", labelKey: "statuses.working", tone: "brand" },
  { value: "resolved", labelKey: "statuses.resolved", tone: "success" },
  { value: "closed", labelKey: "statuses.closed", tone: "muted" },
];

/**
 * Cases (crm_cases): post-sale support tickets. Linked to an account and a
 * contact, with priority/type/queue, a resolution SLA and resolution notes.
 * `sla` is a read-only virtual field (cases/sla-virtual.ts); resolution time
 * is stamped by the DB rules trigger and shown directly from the column.
 */
export const caseConfig: RecordConfig = {
  object: "case",
  table: "crm_cases",
  module: "cases",
  namespace: "cases",
  basePath: "/cases",
  icon: LifeBuoy,
  nameFields: ["subject"],
  fields: [
    {
      key: "subject",
      labelKey: "fields.subject",
      type: "text",
      required: true,
      max: 300,
      listable: true,
      sortable: true,
      searchable: true,
      wide: true,
    },
    {
      key: "case_number",
      labelKey: "fields.number",
      type: "number",
      editable: false,
      creatable: false,
      listable: true,
      sortable: true,
    },
    {
      key: "status",
      labelKey: "fields.status",
      type: "picklist",
      required: true,
      defaultValue: "new",
      picklist: { kind: "static", options: CASE_STATUS_OPTIONS },
      listable: true,
      sortable: true,
      filterable: true,
    },
    {
      key: "priority",
      labelKey: "fields.priority",
      type: "picklist",
      required: true,
      defaultValue: "normal",
      picklist: { kind: "static", options: CASE_PRIORITY_OPTIONS },
      listable: true,
      sortable: true,
      filterable: true,
    },
    {
      key: "type",
      labelKey: "fields.type",
      type: "picklist",
      required: true,
      defaultValue: "question",
      picklist: { kind: "static", options: CASE_TYPES },
      listable: true,
      filterable: true,
    },
    {
      key: "queue",
      labelKey: "fields.queue",
      type: "picklist",
      required: true,
      defaultValue: "support",
      picklist: { kind: "static", options: CASE_QUEUES },
      listable: true,
      filterable: true,
    },
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
          { value: "met", labelKey: "sla.met", tone: "brand" },
          { value: "missed", labelKey: "sla.missed", tone: "danger" },
        ],
      },
    },
    { key: "account_id", labelKey: "fields.account", type: "lookup", lookup: "account", listable: true, filterable: true },
    { key: "contact_id", labelKey: "fields.contact", type: "lookup", lookup: "contact", listable: true, filterable: true },
    { key: "order_ref", labelKey: "fields.orderRef", type: "text", max: 120 },
    { key: "owner_id", labelKey: "fields.owner", type: "owner", listable: true, filterable: true },
    { key: "description", labelKey: "fields.description", type: "textarea", wide: true, searchable: true },
    { key: "source_email", labelKey: "fields.sourceEmail", type: "email", editable: false, creatable: false },
    {
      key: "source_message_id",
      labelKey: "fields.sourceMessage",
      type: "text",
      editable: false,
      creatable: false,
      hideInDetails: true,
    },
    { key: "first_response_at", labelKey: "fields.firstResponseAt", type: "datetime", editable: false, sortable: true },
    { key: "sla_due_at", labelKey: "fields.slaDueAt", type: "datetime", editable: false, sortable: true },
    { key: "resolved_at", labelKey: "fields.resolvedAt", type: "datetime", editable: false, sortable: true },
    { key: "resolution_minutes", labelKey: "fields.resolutionMinutes", type: "number", editable: false, sortable: true },
    { key: "resolution_notes", labelKey: "fields.resolutionNotes", type: "textarea", wide: true },
    { key: "created_at", labelKey: "fields.createdAt", type: "datetime", editable: false, listable: true, sortable: true },
    { key: "updated_at", labelKey: "fields.updatedAt", type: "datetime", editable: false, sortable: true },
  ],
  highlights: ["status", "sla", "priority", "queue", "account_id", "contact_id"],
  listColumns: [
    "subject",
    "case_number",
    "status",
    "sla",
    "priority",
    "queue",
    "account_id",
    "contact_id",
    "owner_id",
    "created_at",
  ],
  defaultSort: { field: "created_at", dir: "desc" },
  path: { field: "status", source: "static" },
  relatedLists: [
    {
      key: "activities",
      object: "activity",
      foreignKey: "what_id",
      where: { what_object: "case" },
      columns: ["subject", "type", "status", "due_at"],
      labelKey: "related.activities",
    },
  ],
  actions: [
    { key: "changeOwner", labelKey: "changeOwner", permission: "edit", kind: "changeOwner", icon: UserRoundCog },
    { key: "delete", labelKey: "delete", permission: "delete", kind: "delete", icon: Trash2 },
  ],
  timeline: true,
};
