/**
 * Pure mirror of the SQL `crm_assign_lead_owner` rule matching. Used for the
 * client-side preview and tests; the database stays the source of truth.
 */
import type { AssignmentRule, AssignmentVia } from "./types";

export type MatchableRule = Pick<
  AssignmentRule,
  "id" | "active" | "sortOrder" | "countryCodes" | "entityIds" | "sources" | "targetType" | "targetUserId" | "poolUserIds" | "stopProcessing"
>;

export type LeadCriteria = { countryCode?: string | null; entityId?: string | null; source?: string | null };

/** Empty criterion = any; a null/blank value never matches a non-empty criterion. */
function includesValue(criterion: string[], value: string | null | undefined, ci = false): boolean {
  if (criterion.length === 0) return true;
  if (value == null || value === "") return false;
  return ci
    ? criterion.some((c) => c.toLowerCase() === value.toLowerCase())
    : criterion.includes(value);
}

export function ruleMatches(rule: MatchableRule, lead: LeadCriteria): boolean {
  return (
    rule.active &&
    includesValue(rule.countryCodes, lead.countryCode, true) &&
    includesValue(rule.entityIds, lead.entityId) &&
    includesValue(rule.sources, lead.source)
  );
}

/** Rules in evaluation order (sort_order, then id for stability). */
export function orderRules<T extends Pick<MatchableRule, "id" | "sortOrder">>(rules: T[]): T[] {
  return [...rules].sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Next eligible pool member after `lastUserId`, wrapping around. A cursor that
 * is no longer in the pool restarts from the first member. Null when nobody is eligible.
 */
export function nextRoundRobin(
  pool: string[],
  eligible: ReadonlySet<string>,
  lastUserId: string | null | undefined
): string | null {
  if (pool.length === 0) return null;
  const start = lastUserId ? pool.indexOf(lastUserId) + 1 : 0; // indexOf -1 -> 0
  for (let i = 0; i < pool.length; i++) {
    const candidate = pool[(start + i) % pool.length];
    if (eligible.has(candidate)) return candidate;
  }
  return null;
}

export type AssignmentContext = {
  /** Active users with can_write. */
  eligibleUserIds: ReadonlySet<string>;
  /** rule id -> last assigned user id. */
  cursors?: Readonly<Record<string, string | null>>;
  fallback: { ownerId: string | null; via: Extract<AssignmentVia, "default" | "super_admin"> };
};

export type AssignmentOutcome = {
  ownerId: string | null;
  ruleId: string | null;
  via: AssignmentVia;
  /** Round-robin cursor to persist (absent for previews or other targets). */
  cursor?: { ruleId: string; userId: string };
};

export function resolveAssignment(
  rules: MatchableRule[],
  lead: LeadCriteria,
  ctx: AssignmentContext
): AssignmentOutcome {
  const fallback: AssignmentOutcome = { ownerId: ctx.fallback.ownerId, ruleId: null, via: ctx.fallback.via };
  for (const rule of orderRules(rules)) {
    if (!ruleMatches(rule, lead)) continue;
    let assignee: string | null = null;
    if (rule.targetType === "user") {
      assignee = rule.targetUserId && ctx.eligibleUserIds.has(rule.targetUserId) ? rule.targetUserId : null;
    } else {
      assignee = nextRoundRobin(rule.poolUserIds, ctx.eligibleUserIds, ctx.cursors?.[rule.id]);
    }
    if (assignee) {
      return {
        ownerId: assignee,
        ruleId: rule.id,
        via: rule.targetType === "user" ? "rule" : "round_robin",
        ...(rule.targetType === "round_robin" ? { cursor: { ruleId: rule.id, userId: assignee } } : {}),
      };
    }
    if (rule.stopProcessing) return fallback;
  }
  return fallback;
}
