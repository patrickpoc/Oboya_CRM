import type { CrmAction, CrmModule } from "@/lib/crm/types";
import type { RecordActionConfig, RecordConfig, RecordRow } from "./types";

export type RecordAccess = {
  /** The record itself is locked (config.readOnly), whatever the user's permissions. */
  readOnly: boolean;
  /** Inline edits and the default path. */
  canEdit: boolean;
  /** Built-in header actions to render (none on a read-only record). */
  actions: RecordActionConfig[];
};

/** What the record page lets the user do: module permissions AND the record's read-only state. */
export function recordAccess(
  config: RecordConfig,
  row: RecordRow,
  can: (module: CrmModule, action: CrmAction) => boolean
): RecordAccess {
  const readOnly = Boolean(config.readOnly?.(row));
  return {
    readOnly,
    canEdit: !readOnly && can(config.module, "edit"),
    actions: readOnly ? [] : config.actions.filter((a) => can(config.module, a.permission)),
  };
}
