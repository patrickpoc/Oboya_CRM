import { z } from "zod";
import {
  ALERT_KINDS,
  ASSIGNMENT_TARGET_TYPES,
  MAX_POOL_USERS,
  STAGE_TASK_ASSIGNEE_TYPES,
  TASK_PRIORITIES,
} from "./types";

const uuid = z.string().uuid();
const iso2 = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/);
const uniq = <T extends z.ZodType<string>>(item: T, max: number) =>
  z.array(item).max(max).transform((a) => [...new Set(a)]);

const assignmentRuleShape = z.object({
  name: z.string().trim().min(1).max(120),
  active: z.boolean().default(true),
  countryCodes: uniq(iso2, 300).default([]),
  entityIds: uniq(uuid, 100).default([]),
  sources: uniq(z.string().trim().min(1).max(80), 50).default([]),
  targetType: z.enum(ASSIGNMENT_TARGET_TYPES),
  targetUserId: uuid.nullable().default(null),
  poolUserIds: uniq(uuid, MAX_POOL_USERS).default([]),
  stopProcessing: z.boolean().default(false),
  notifyAssignee: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(100000).optional(),
});

/** user target needs targetUserId; round_robin needs a non-empty pool. */
const targetConsistent = (v: { targetType: string; targetUserId: string | null; poolUserIds: string[] }) =>
  v.targetType === "user" ? v.targetUserId !== null : v.poolUserIds.length > 0;
const targetMessage = { message: "target_inconsistent", path: ["targetType"] };

export const assignmentRuleSchema = assignmentRuleShape.refine(targetConsistent, targetMessage);
/** PATCH: every field optional; the route merges with the stored row and re-checks targetConsistent. */
export const assignmentRulePatchSchema = assignmentRuleShape
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "empty_patch" });
export { targetConsistent as isAssignmentTargetConsistent };

export const reorderSchema = z.object({ ids: z.array(uuid).min(1).max(200) });

export const assignmentPreviewSchema = z.object({
  countryCode: iso2.nullish(),
  entityId: uuid.nullish(),
  source: z.string().trim().max(80).nullish(),
});

const stageTaskShape = z.object({
  stageId: uuid,
  pipelineId: uuid,
  subject: z.string().trim().min(1).max(300),
  description: z.string().trim().max(5000).nullable().default(null),
  dueInDays: z.number().int().min(0).max(365),
  priority: z.enum(TASK_PRIORITIES).default("normal"),
  assigneeType: z.enum(STAGE_TASK_ASSIGNEE_TYPES).default("owner"),
  assigneeUserId: uuid.nullable().default(null),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(100000).optional(),
});
const assigneeConsistent = (v: { assigneeType: string; assigneeUserId: string | null }) =>
  v.assigneeType !== "user" || v.assigneeUserId !== null;
const assigneeMessage = { message: "assignee_inconsistent", path: ["assigneeUserId"] };

export const stageTaskSchema = stageTaskShape.refine(assigneeConsistent, assigneeMessage);
export const stageTaskPatchSchema = stageTaskShape
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "empty_patch" });

export const alertRuleSchema = z.object({
  kind: z.enum(ALERT_KINDS),
  pipelineId: uuid.nullish(),
  stageId: uuid.nullish(),
  threshold: z.number().int().min(0).max(3650),
  notifyManager: z.boolean().default(false),
  active: z.boolean().default(true),
});
export const alertRulePatchSchema = alertRuleSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "empty_patch" });

export const runsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
