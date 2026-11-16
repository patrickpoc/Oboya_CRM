import { z } from "zod";
import { CRM_ACTIONS, CRM_MODULES } from "@/lib/crm/types";
import { locales } from "@/i18n/routing";
import { PICKLISTS, PICKLIST_VALUE_RE } from "./picklists";
import { STAGE_COLOR_TOKENS } from "./stages";

/** Input schemas for the /api/crm setup handlers. */

const roleId = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v ? v : null));

export const levelSchema = z.union([
  z.literal("full"),
  z.literal("none"),
  z.array(z.enum(CRM_ACTIONS)).max(CRM_ACTIONS.length),
]);

const moduleMap = z.partialRecord(z.enum(CRM_MODULES), levelSchema);

export const overridesSchema = z
  .object({ grants: moduleMap.optional(), denies: moduleMap.optional() })
  .strict();

export const matrixSchema = z.record(roleId, moduleMap);

export const accessControlPutSchema = z.object({ matrix: matrixSchema }).strict();

export const userCreateSchema = z
  .object({
    email: z.email().max(254).transform((v) => v.trim().toLowerCase()),
    fullName: z.string().trim().min(1).max(120),
    role: roleId,
    teamId: z.uuid().nullable().optional(),
    locale: z.enum(locales).optional(),
    receivesInbound: z.boolean().optional(),
    title: optionalText(120),
  })
  .strict();

export const userPatchSchema = z
  .object({
    fullName: z.string().trim().min(1).max(120).optional(),
    title: optionalText(120),
    phone: optionalText(40),
    role: roleId.optional(),
    teamId: z.uuid().nullable().optional(),
    status: z.enum(["active", "disabled"]).optional(),
    locale: z.enum(locales).optional(),
    receivesInbound: z.boolean().optional(),
    permissionOverrides: overridesSchema.optional(),
  })
  .strict();

export const roleCreateSchema = z
  .object({
    id: roleId,
    label: z.string().trim().min(1).max(80),
    description: optionalText(300),
    visibilityScope: z.enum(["own", "team", "all"]),
    canWrite: z.boolean(),
    /** Copies the access-matrix row of this role (otherwise no permissions). */
    baseRole: roleId.optional(),
  })
  .strict();

export const rolePatchSchema = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    description: optionalText(300),
    visibilityScope: z.enum(["own", "team", "all"]).optional(),
    canWrite: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .strict();

export const teamSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    description: optionalText(300),
    managerId: z.uuid().nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict();

export const entitySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    legalName: optionalText(200),
    countryCode: z.preprocess(
      (v) => (typeof v === "string" ? v.trim().toUpperCase() || null : v),
      z.string().regex(/^[A-Z]{2}$/).nullable().optional()
    ),
    taxId: optionalText(60),
    defaultCurrency: z.enum(["BRL", "USD", "EUR", "CNY"]),
    active: z.boolean().optional(),
  })
  .strict();

export const stageCreateSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    probability: z.number().int().min(0).max(100),
    colorToken: z.enum(STAGE_COLOR_TOKENS).nullable().optional(),
  })
  .strict();

export const stagePatchSchema = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    probability: z.number().int().min(0).max(100).optional(),
    colorToken: z.enum(STAGE_COLOR_TOKENS).nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict();

export const stageDeleteSchema = z
  .object({ targetStageId: z.uuid().nullable().optional() })
  .strict();

export const reorderSchema = z
  .object({ ids: z.array(z.uuid()).min(1).max(200) })
  .strict();

export const picklistCreateSchema = z
  .object({
    picklist: z.enum(PICKLISTS),
    value: z.string().regex(PICKLIST_VALUE_RE),
    label: z.string().trim().min(1).max(120),
  })
  .strict();

export const picklistPatchSchema = z
  .object({
    label: z.string().trim().min(1).max(120).optional(),
    active: z.boolean().optional(),
  })
  .strict();

export const picklistReorderSchema = z
  .object({ picklist: z.enum(PICKLISTS), ids: z.array(z.uuid()).min(1).max(500) })
  .strict();

export const leadAssignmentSchema = z
  .object({
    mode: z.enum(["round_robin", "default_owner"]),
    defaultOwnerId: z.uuid().nullable(),
  })
  .strict()
  .refine((v) => v.mode !== "default_owner" || v.defaultOwnerId !== null, {
    message: "default_owner_required",
    path: ["defaultOwnerId"],
  });

export const receivesInboundSchema = z.object({ receivesInbound: z.boolean() }).strict();

export const auditQuerySchema = z.object({
  object: z.string().max(40).optional(),
  action: z.string().max(40).optional(),
  actor: z.uuid().optional(),
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  page: z.coerce.number().int().min(0).max(10000).default(0),
  pageSize: z.coerce.number().int().min(5).max(100).default(25),
});
