import { Target, Trash2, UserRoundCog } from "lucide-react";
import { z } from "zod";
import type { RecordConfig, StaticOption } from "./types";

export const OPPORTUNITY_CURRENCIES = ["BRL", "USD", "EUR", "CNY"] as const;

const currencyOptions: StaticOption[] = OPPORTUNITY_CURRENCIES.map((c) => ({ value: c, labelKey: `currencies.${c}` }));

/**
 * Opportunities (crm_opportunities). Stage changes go through
 * POST /api/crm/opportunities/[id]/stage (lib/crm/opportunities/stages.ts), so
 * `stage_id` and the loss fields are not editable through the generic PATCH.
 * Loss reason/note are shown by the record path slot only when the stage is lost.
 * `stage_kind` is a read-only virtual field used by the open/won/lost filter.
 */
export const opportunityConfig: RecordConfig = {
  object: "opportunity",
  table: "crm_opportunities",
  module: "opportunities",
  namespace: "opportunities",
  basePath: "/opportunities",
  icon: Target,
  nameFields: ["name"],
  fields: [
    {
      key: "name",
      labelKey: "fields.name",
      type: "text",
      required: true,
      max: 200,
      listable: true,
      sortable: true,
      searchable: true,
    },
    {
      key: "account_id",
      labelKey: "fields.account",
      type: "lookup",
      lookup: "account",
      required: true,
      listable: true,
      filterable: true,
    },
    { key: "primary_contact_id", labelKey: "fields.primaryContact", type: "lookup", lookup: "contact", filterable: true },
    {
      key: "stage_id",
      labelKey: "fields.stage",
      type: "picklist",
      picklist: { kind: "stages" },
      zod: z.guid(),
      required: true,
      editable: false,
      creatable: true,
      listable: true,
      filterable: true,
    },
    {
      key: "stage_kind",
      labelKey: "fields.status",
      type: "picklist",
      picklist: {
        kind: "static",
        options: [
          { value: "open", labelKey: "status.open", tone: "info" },
          { value: "won", labelKey: "status.won", tone: "success" },
          { value: "lost", labelKey: "status.lost", tone: "danger" },
        ],
      },
      virtual: true,
      editable: false,
      filterable: true,
      hideInDetails: true,
    },
    { key: "probability", labelKey: "fields.probability", type: "percent", listable: true, sortable: true },
    {
      key: "amount",
      labelKey: "fields.amount",
      type: "currency",
      currencyField: "currency",
      listable: true,
      sortable: true,
    },
    {
      key: "currency",
      labelKey: "fields.currency",
      type: "picklist",
      picklist: { kind: "static", options: currencyOptions },
      required: true,
      defaultValue: "USD",
      filterable: true,
    },
    { key: "close_date", labelKey: "fields.closeDate", type: "date", listable: true, sortable: true, filterable: true },
    {
      key: "lead_source",
      labelKey: "fields.leadSource",
      type: "picklist",
      picklist: { kind: "picklist", picklist: "lead_source" },
      filterable: true,
    },
    { key: "entity_id", labelKey: "fields.entity", type: "entity", listable: true, filterable: true },
    { key: "owner_id", labelKey: "fields.owner", type: "owner", listable: true, filterable: true },
    { key: "next_step", labelKey: "fields.nextStep", type: "text", max: 255 },
    {
      key: "loss_reason",
      labelKey: "fields.lossReason",
      type: "picklist",
      picklist: { kind: "picklist", picklist: "loss_reason" },
      editable: false,
      hideInDetails: true,
    },
    { key: "loss_note", labelKey: "fields.lossNote", type: "textarea", max: 2000, editable: false, hideInDetails: true },
    { key: "description", labelKey: "fields.description", type: "textarea", wide: true },
    { key: "closed_at", labelKey: "fields.closedAt", type: "datetime", editable: false, sortable: true },
    { key: "created_at", labelKey: "fields.createdAt", type: "datetime", editable: false, sortable: true },
    { key: "updated_at", labelKey: "fields.updatedAt", type: "datetime", editable: false, sortable: true },
  ],
  highlights: ["account_id", "amount", "close_date", "stage_id"],
  listColumns: ["name", "account_id", "stage_id", "amount", "probability", "close_date", "owner_id"],
  defaultSort: { field: "close_date", dir: "asc" },
  path: { field: "stage_id", source: "stages" },
  relatedLists: [],
  actions: [
    { key: "changeOwner", labelKey: "changeOwner", permission: "edit", kind: "changeOwner", icon: UserRoundCog },
    { key: "delete", labelKey: "delete", permission: "delete", kind: "delete", icon: Trash2 },
  ],
  timeline: true,
};
