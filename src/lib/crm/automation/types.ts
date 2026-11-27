/** Client-safe automation types and camel <-> snake column mapping. */

export const ASSIGNMENT_TARGET_TYPES = ["user", "round_robin"] as const;
export type AssignmentTargetType = (typeof ASSIGNMENT_TARGET_TYPES)[number];

export const ASSIGNMENT_VIAS = ["rule", "round_robin", "default", "super_admin"] as const;
export type AssignmentVia = (typeof ASSIGNMENT_VIAS)[number];

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const STAGE_TASK_ASSIGNEE_TYPES = ["owner", "owner_manager", "user"] as const;
export type StageTaskAssigneeType = (typeof STAGE_TASK_ASSIGNEE_TYPES)[number];

export const ALERT_KINDS = ["stalled_deal", "overdue_task", "sla_escalation"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export const RUN_STATUSES = ["ok", "partial", "failed", "skipped"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_TRIGGERS = ["pg_cron", "vercel_cron", "manual"] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

export const MAX_POOL_USERS = 50;

export type AssignmentRuleInput = {
  name: string;
  active: boolean;
  /** Empty array = any. ISO-2, upper-case. */
  countryCodes: string[];
  /** Empty = any. */
  entityIds: string[];
  /** Empty = any. */
  sources: string[];
  targetType: AssignmentTargetType;
  targetUserId: string | null;
  poolUserIds: string[];
  stopProcessing: boolean;
  notifyAssignee: boolean;
  sortOrder?: number;
};

type RowBase = { id: string; createdAt: string; updatedAt: string };

export type AssignmentRule = AssignmentRuleInput & RowBase & { sortOrder: number };

export type StageTaskTemplateInput = {
  stageId: string;
  pipelineId: string;
  subject: string;
  description: string | null;
  dueInDays: number;
  priority: TaskPriority;
  assigneeType: StageTaskAssigneeType;
  assigneeUserId: string | null;
  active: boolean;
  sortOrder?: number;
};
export type StageTaskTemplate = StageTaskTemplateInput & RowBase & { sortOrder: number };

export type AlertRuleInput = {
  kind: AlertKind;
  pipelineId?: string | null;
  stageId?: string | null;
  /** stalled_deal: days. overdue_task: grace hours. sla_escalation: unused (0). */
  threshold: number;
  notifyManager: boolean;
  active: boolean;
};
export type AlertRule = Omit<AlertRuleInput, "pipelineId" | "stageId"> &
  RowBase & { pipelineId: string | null; stageId: string | null };

export type AutomationRunError = { section: string; message: string };

export type AutomationRun = {
  id: string;
  trigger: RunTrigger;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  /** Items handled per section, e.g. { stalled: 3, overdue: 0, sla: 1 }. */
  counts: Record<string, number>;
  /** At most 20. */
  errors: AutomationRunError[];
};

export type AssignmentPreviewInput = {
  countryCode?: string | null;
  entityId?: string | null;
  source?: string | null;
};
export type AssignmentPreviewResult = {
  ownerId: string | null;
  ruleId: string | null;
  via: AssignmentVia;
};

/* ---------------- DB column mapping (camelCase <-> snake_case) ---------------- */

type Row = Record<string, unknown>;

const toSnakeKey = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toCamelKey = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

function mapKeys(obj: Row, fn: (k: string) => string): Row {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [fn(k), v]));
}

/** Drops undefined values so partial updates only touch provided columns. */
export function toDbRow(input: object): Row {
  const clean = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  return mapKeys(clean, toSnakeKey);
}

export function fromDbRow<T>(row: Row): T {
  return mapKeys(row, toCamelKey) as T;
}

/** Columns to select for each config table (snake_case). */
export const ASSIGNMENT_RULE_COLUMNS =
  "id,name,active,sort_order,country_codes,entity_ids,sources,target_type,target_user_id,pool_user_ids,stop_processing,notify_assignee,created_at,updated_at";
export const STAGE_TASK_COLUMNS =
  "id,stage_id,pipeline_id,subject,description,due_in_days,priority,assignee_type,assignee_user_id,active,sort_order,created_at,updated_at";
export const ALERT_RULE_COLUMNS =
  "id,kind,pipeline_id,stage_id,threshold,notify_manager,active,created_at,updated_at";
export const AUTOMATION_RUN_COLUMNS = "id,trigger,status,started_at,finished_at,counts,errors";
