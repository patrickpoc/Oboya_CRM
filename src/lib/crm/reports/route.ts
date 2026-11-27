import "server-only";

import { getTranslations } from "next-intl/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { safeTimeZone } from "@/lib/crm/dashboard/time";
import { getRecordConfig } from "@/lib/crm/objects/registry";
import { canAccessUser } from "@/lib/crm/permissions/access-resolve";
import { crmGuard, type CrmGuardOk } from "@/lib/crm/server/require-crm-auth";
import { dbErrorResponse, jsonError } from "@/lib/crm/setup/api.server";
import type { CrmAction } from "@/lib/crm/types";
import {
  DashboardInputSchema,
  FolderInputSchema,
  ReportInputSchema,
  REPORT_VISIBILITIES,
  validateDefinition,
  type ReportDefinition,
  type ReportObject,
} from "./definition";
import { ReportDefinitionError, type RunOptions } from "./engine";
import type { Translate } from "./labels";
import type { Viewer } from "./repository";

export type ReportsGuard = CrmGuardOk;

/** crmGuard on the `reports` module. */
export const reportsGuard = (action: CrmAction) => crmGuard("reports", action);

export const viewerOf = (g: CrmGuardOk): Viewer => ({
  id: g.user.id,
  teamId: g.user.teamId,
  role: g.user.role,
});

export const forbidden = () => jsonError(403, "forbidden", "Forbidden");
export const notFound = () => jsonError(404, "not_found", "Not found");

/** Postgres errors map to safe responses; a definition that does not validate is 422. */
export function failure(error: unknown, context: string) {
  if (error instanceof ReportDefinitionError) {
    return jsonError(422, "invalid_definition", "Invalid report definition", { issues: error.issues });
  }
  return dbErrorResponse(error as { code?: string; message?: string }, context);
}

/** Viewer's `can(objectModule, action)` for a report object; false for an unknown object. */
export function canOnObject(g: CrmGuardOk, object: ReportObject, action: CrmAction): boolean {
  const config = getRecordConfig(object);
  return !!config && canAccessUser(g.user, config.module, action, g.matrix);
}

export async function runOptions(g: CrmGuardOk, tz: unknown): Promise<RunOptions> {
  const t = await getTranslations();
  return {
    userId: g.user.id,
    timeZone: safeTimeZone(tz),
    locale: g.user.locale,
    t: ((key, values) => t(key as never, values as never)) as Translate,
  };
}

export async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => null);
}

export function invalidInput(error: z.ZodError) {
  const fields = Object.fromEntries(error.issues.map((i) => [i.path.join(".") || "_", i.message]));
  return jsonError(400, "invalid_input", "Invalid input", { fields });
}

export const IdSchema = z.guid();
export const TzSchema = z.string().max(64).optional();

// Patch bodies: the create schemas without refinements/defaults, every field optional.
const teamRequired = (v: { visibility?: string; teamId?: string | null }) =>
  v.visibility !== "team" || !!v.teamId;

export const FolderPatchSchema = z
  .object({
    name: FolderInputSchema.shape.name.optional(),
    visibility: z.enum(REPORT_VISIBILITIES).optional(),
    teamId: z.guid().nullish(),
  })
  .refine(teamRequired, { path: ["teamId"], message: "team_required" });

export const ReportPatchSchema = z.object({
  name: ReportInputSchema.shape.name.optional(),
  description: ReportInputSchema.shape.description.removeDefault().optional(),
  folderId: z.guid().nullish(),
  definition: ReportInputSchema.shape.definition.optional(),
});

export const DashboardPatchSchema = z
  .object({
    name: DashboardInputSchema.shape.name.optional(),
    description: DashboardInputSchema.shape.description.removeDefault().optional(),
    visibility: z.enum(REPORT_VISIBILITIES).optional(),
    teamId: z.guid().nullish(),
    widgets: DashboardInputSchema.shape.widgets.removeDefault().optional(),
  })
  .refine(teamRequired, { path: ["teamId"], message: "team_required" });

/** The definition's semantic check against its object (stale fields, wrong shape): a 422 or null. */
export function definitionProblem(def: ReportDefinition): NextResponse | null {
  const config = getRecordConfig(def.object);
  const result = config
    ? validateDefinition(def, config)
    : ({ ok: false, issues: [{ path: "object", code: "wrong_object" }] } as const);
  return result.ok
    ? null
    : jsonError(422, "invalid_definition", "Invalid report definition", { issues: result.issues });
}
