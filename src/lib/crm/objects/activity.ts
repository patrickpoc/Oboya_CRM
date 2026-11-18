import { CalendarCheck, Trash2, UserRoundCog } from "lucide-react";
import type { RecordConfig, StaticOption } from "./types";

/** Objects an activity can be related to (crm_activities.what_object check). */
export const ACTIVITY_PARENTS = ["lead", "account", "contact", "opportunity", "case"] as const;
export type ActivityParent = (typeof ACTIVITY_PARENTS)[number];

export const ACTIVITY_TYPES: StaticOption[] = [
  { value: "task", labelKey: "types.task", tone: "brand" },
  { value: "call", labelKey: "types.call", tone: "info" },
  { value: "meeting", labelKey: "types.meeting", tone: "highlight" },
  { value: "note", labelKey: "types.note", tone: "neutral" },
  { value: "email", labelKey: "types.email", tone: "muted" },
];

/**
 * Activities (crm_activities). The related record is polymorphic:
 * what_object + what_id (`lookupFrom`), set at creation by the timeline
 * composer through POST /api/crm/activities, read-only afterwards.
 * `due_range` is a filter-only virtual field (repositories/virtual-fields.ts).
 */
export const activityConfig: RecordConfig = {
  object: "activity",
  table: "crm_activities",
  module: "activities",
  namespace: "activities",
  basePath: "/activities",
  icon: CalendarCheck,
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
      key: "type",
      labelKey: "fields.type",
      type: "picklist",
      required: true,
      defaultValue: "task",
      picklist: { kind: "static", options: ACTIVITY_TYPES },
      listable: true,
      sortable: true,
      filterable: true,
    },
    {
      key: "status",
      labelKey: "fields.status",
      type: "picklist",
      required: true,
      defaultValue: "open",
      picklist: {
        kind: "static",
        options: [
          { value: "open", labelKey: "statuses.open", tone: "info" },
          { value: "done", labelKey: "statuses.done", tone: "success" },
        ],
      },
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
      picklist: {
        kind: "static",
        options: [
          { value: "low", labelKey: "priorities.low", tone: "muted" },
          { value: "normal", labelKey: "priorities.normal", tone: "neutral" },
          { value: "high", labelKey: "priorities.high", tone: "warning" },
          { value: "urgent", labelKey: "priorities.urgent", tone: "danger" },
        ],
      },
      listable: true,
      sortable: true,
      filterable: true,
    },
    { key: "due_at", labelKey: "fields.dueAt", type: "datetime", listable: true, sortable: true },
    {
      key: "due_range",
      labelKey: "fields.dueRange",
      type: "picklist",
      virtual: true,
      editable: false,
      hideInDetails: true,
      filterable: true,
      picklist: {
        kind: "static",
        options: [
          { value: "overdue", labelKey: "dueRanges.overdue" },
          { value: "next7", labelKey: "dueRanges.next7" },
          { value: "later", labelKey: "dueRanges.later" },
          { value: "none", labelKey: "dueRanges.none" },
        ],
      },
    },
    {
      key: "what_object",
      labelKey: "fields.whatObject",
      type: "picklist",
      editable: false,
      hideInDetails: true,
      picklist: {
        kind: "static",
        options: ACTIVITY_PARENTS.map((value) => ({ value, labelKey: `objects.${value}` })),
      },
      filterable: true,
    },
    {
      key: "what_id",
      labelKey: "fields.related",
      type: "lookup",
      lookupFrom: "what_object",
      editable: false,
      listable: true,
      filterable: true,
    },
    { key: "who_contact_id", labelKey: "fields.contact", type: "lookup", lookup: "contact", filterable: true },
    { key: "owner_id", labelKey: "fields.owner", type: "owner", listable: true, filterable: true },
    { key: "body", labelKey: "fields.body", type: "textarea", wide: true, searchable: true },
    { key: "completed_at", labelKey: "fields.completedAt", type: "datetime", editable: false, sortable: true },
    {
      key: "created_at",
      labelKey: "fields.createdAt",
      type: "datetime",
      editable: false,
      listable: true,
      sortable: true,
    },
    { key: "updated_at", labelKey: "fields.updatedAt", type: "datetime", editable: false, sortable: true },
  ],
  highlights: ["type", "priority", "due_at", "what_id", "who_contact_id"],
  listColumns: ["subject", "type", "status", "priority", "due_at", "what_id", "owner_id"],
  defaultSort: { field: "created_at", dir: "desc" },
  path: { field: "status", source: "static" },
  relatedLists: [],
  actions: [
    { key: "changeOwner", labelKey: "changeOwner", permission: "edit", kind: "changeOwner", icon: UserRoundCog },
    { key: "delete", labelKey: "delete", permission: "delete", kind: "delete", icon: Trash2 },
  ],
  timeline: false,
};
