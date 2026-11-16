import { Trash2, UserRoundCog, UsersRound } from "lucide-react";
import type { RecordConfig } from "./types";

/**
 * Contacts (crm_contacts). `account_id` is nullable in the DB (conversion and
 * imports), but the app always requires it. The row guard rejects an account
 * the user cannot see (403).
 */
export const contactConfig: RecordConfig = {
  object: "contact",
  table: "crm_contacts",
  module: "contacts",
  namespace: "contacts",
  basePath: "/contacts",
  icon: UsersRound,
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
    { key: "first_name", labelKey: "fields.firstName", type: "text", max: 120, sortable: true },
    { key: "last_name", labelKey: "fields.lastName", type: "text", required: true, max: 120, sortable: true },
    {
      key: "account_id",
      labelKey: "fields.account",
      type: "lookup",
      lookup: "account",
      required: true,
      listable: true,
      filterable: true,
    },
    { key: "title", labelKey: "fields.title", type: "text", max: 120, listable: true, searchable: true },
    { key: "email", labelKey: "fields.email", type: "email", listable: true, searchable: true },
    { key: "phone", labelKey: "fields.phone", type: "phone", listable: true, searchable: true },
    { key: "mobile", labelKey: "fields.mobile", type: "phone", searchable: true },
    { key: "country_code", labelKey: "fields.country", type: "country", listable: true, sortable: true, filterable: true },
    { key: "owner_id", labelKey: "fields.owner", type: "owner", listable: true, filterable: true },
    { key: "description", labelKey: "fields.description", type: "textarea", wide: true },
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
  highlights: ["account_id", "title", "email", "phone"],
  listColumns: ["full_name", "account_id", "title", "email", "phone", "country_code", "owner_id"],
  defaultSort: { field: "full_name", dir: "asc" },
  relatedLists: [
    {
      key: "opportunities",
      object: "opportunity",
      foreignKey: "primary_contact_id",
      columns: ["stage_id", "amount", "close_date"],
      labelKey: "related.opportunities",
    },
  ],
  actions: [
    { key: "changeOwner", labelKey: "changeOwner", permission: "edit", kind: "changeOwner", icon: UserRoundCog },
    { key: "delete", labelKey: "delete", permission: "delete", kind: "delete", icon: Trash2 },
  ],
  timeline: true,
};
