/**
 * Route paths and request/response types of the automation and notification
 * APIs. Client-safe. Errors use the shared `{ error, code, fields? }` shape.
 * Dates are ISO strings. Bodies are validated by ./schemas and notifications/schemas.
 */
import type { Notification } from "@/lib/crm/notifications/schemas";
import type {
  AlertRule,
  AlertRuleInput,
  AssignmentPreviewInput,
  AssignmentPreviewResult,
  AssignmentRule,
  AssignmentRuleInput,
  AutomationRun,
  StageTaskTemplate,
  StageTaskTemplateInput,
} from "./types";

export type ApiErrorBody = { error: string; code: string; fields?: Record<string, string> };

export const AUTOMATION_API = {
  /** GET list (automation.view) | POST create (automation.edit): body AssignmentRuleInput. */
  assignmentRules: "/api/crm/automation/assignment-rules",
  /** PATCH (Partial<AssignmentRuleInput>) | DELETE, automation.edit. */
  assignmentRule: (id: string) => `/api/crm/automation/assignment-rules/${id}`,
  /** POST, automation.edit. Body ReorderBody. */
  assignmentRulesReorder: "/api/crm/automation/assignment-rules/reorder",
  /** POST, automation.view. Body AssignmentPreviewInput. */
  assignmentRulesPreview: "/api/crm/automation/assignment-rules/preview",
  /** GET (optional ?pipelineId=&stageId=) | POST. */
  stageTasks: "/api/crm/automation/stage-tasks",
  stageTask: (id: string) => `/api/crm/automation/stage-tasks/${id}`,
  stageTasksReorder: "/api/crm/automation/stage-tasks/reorder",
  alertRules: "/api/crm/automation/alert-rules",
  alertRule: (id: string) => `/api/crm/automation/alert-rules/${id}`,
  /** GET (automation.view). Query RunsQuery. */
  runs: "/api/crm/automation/runs",
  /** POST (automation.edit, rate-limited). No body. */
  run: "/api/crm/automation/run",
  /** GET, Vercel cron only (CRON_SECRET bearer). */
  cron: "/api/crm/automation/cron",
} as const;

export const LEAD_ASSIGN_PATH = (leadId: string) => `/api/crm/leads/${leadId}/assign`;

export const NOTIFICATIONS_API = {
  list: "/api/crm/notifications",
  /** POST body MarkReadInput. */
  read: "/api/crm/notifications/read",
} as const;

export const NAV_COUNTS_PATH = "/api/crm/nav-counts";

export type ReorderBody = { ids: string[] };
export type OkResponse = { ok: true };

export type AssignmentRulesResponse = { rules: AssignmentRule[] };
export type AssignmentRuleBody = AssignmentRuleInput;
export type AssignmentRuleResponse = { rule: AssignmentRule };
export type AssignmentPreviewBody = AssignmentPreviewInput;
export type AssignmentPreviewResponse = { result: AssignmentPreviewResult };

export type StageTasksQuery = { pipelineId?: string; stageId?: string };
export type StageTasksResponse = { templates: StageTaskTemplate[] };
export type StageTaskBody = StageTaskTemplateInput;
export type StageTaskResponse = { template: StageTaskTemplate };

export type AlertRulesResponse = { rules: AlertRule[] };
export type AlertRuleBody = AlertRuleInput;
export type AlertRuleResponse = { rule: AlertRule };

export type RunsQuery = { limit?: number };
export type RunsResponse = { runs: AutomationRun[] };
export type RunResponse = { run: AutomationRun };

/** POST /api/crm/leads/[id]/assign (leads.edit). No body. */
/** GET /api/crm/leads/[id]/assign?preview=1 (leads.edit). */
export type LeadAssignPreviewResponse = { result: { ownerId: string | null; via: AssignmentPreviewResult["via"] } };
export type LeadAssignResponse = { ownerId: string; ruleId: string | null; via: AssignmentPreviewResult["via"] };

export type NotificationsQuery = { cursor?: string; limit?: number; unread?: "true" | "false" };
export type NotificationsResponse = {
  notifications: Notification[];
  nextCursor: string | null;
  unreadCount: number;
};
export type MarkReadResponse = { updated: number; unreadCount: number };

/** GET /api/crm/nav-counts additionally returns this. */
export type NavCountsResponse = { leadsNew: number; tasksDue: number; notificationsUnread: number };
