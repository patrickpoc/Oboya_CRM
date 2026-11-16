/*
 * Pipeline stage rules (D6) mirrored from the DB guards in
 * supabase/migrations/20261116000200_crm_picklists.sql and the RPCs
 * crm_reorder_stages / crm_delete_stage (20261116000600_crm_functions.sql).
 */

export const STAGE_COLOR_TOKENS = [
  "oboya-orange",
  "oboya-blue",
  "oboya-blue-light",
  "oboya-green",
  "oboya-green-light",
  "oboya-blue-dark",
  "oboya-yellow-light",
  "oboya-yellow-dark",
  "oboya-soft-white",
] as const;
export type StageColorToken = (typeof STAGE_COLOR_TOKENS)[number];

export type StageKind = "open" | "won" | "lost";

export type SetupStage = {
  id: string;
  label: string;
  probability: number;
  sortOrder: number;
  colorToken: StageColorToken | null;
  kind: StageKind;
  active: boolean;
  opportunityCount: number;
};

/** Moves one item from `from` to `to` (both clamped), returning a new array. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  if (from < 0 || from >= next.length) return next;
  const target = Math.max(0, Math.min(next.length - 1, to));
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}

/** Keyboard reorder: moves the item with `id` one step up (-1) or down (+1). */
export function moveById(ids: readonly string[], id: string, delta: -1 | 1): string[] {
  const index = ids.indexOf(id);
  if (index < 0) return [...ids];
  return moveItem(ids, index, index + delta);
}

/** Same rule as crm_reorder_stages: the new order lists every current id exactly once. */
export function isValidReorder(currentIds: readonly string[], nextIds: readonly string[]): boolean {
  if (currentIds.length !== nextIds.length) return false;
  const next = new Set(nextIds);
  if (next.size !== nextIds.length) return false;
  return currentIds.every((id) => next.has(id));
}

export type StageDeletePlan =
  | { ok: false; reason: "not_found" | "fixed_kind" | "last_open" }
  | { ok: true; needsTarget: false }
  | { ok: true; needsTarget: true; targets: SetupStage[] };

function activeOpen(stages: readonly SetupStage[], exceptId?: string) {
  return stages.filter((s) => s.kind === "open" && s.active && s.id !== exceptId);
}

/** What deleting `stageId` requires: won/lost are fixed, one active open stage must remain. */
export function planStageDelete(stages: readonly SetupStage[], stageId: string): StageDeletePlan {
  const stage = stages.find((s) => s.id === stageId);
  if (!stage) return { ok: false, reason: "not_found" };
  if (stage.kind !== "open") return { ok: false, reason: "fixed_kind" };
  const remaining = activeOpen(stages, stageId);
  if (remaining.length === 0) return { ok: false, reason: "last_open" };
  if (stage.opportunityCount > 0) return { ok: true, needsTarget: true, targets: remaining };
  return { ok: true, needsTarget: false };
}

/** Same check crm_delete_stage runs on the target. */
export function isValidDeleteTarget(
  stages: readonly SetupStage[],
  stageId: string,
  targetId: string | null | undefined
): boolean {
  if (!targetId) return false;
  return activeOpen(stages, stageId).some((s) => s.id === targetId);
}

export type StagePatch = Partial<Pick<SetupStage, "label" | "probability" | "colorToken" | "active" | "kind">>;

export type StageUpdateError = "fixed_kind" | "won_lost_active" | "last_open" | "kind_change";

/** Won/lost keep their kind and stay active; one active open stage must remain. */
export function checkStageUpdate(
  stages: readonly SetupStage[],
  stageId: string,
  patch: StagePatch
): StageUpdateError | null {
  const stage = stages.find((s) => s.id === stageId);
  if (!stage) return null;
  if (patch.kind !== undefined && patch.kind !== stage.kind) {
    return stage.kind === "open" ? "kind_change" : "fixed_kind";
  }
  if (patch.active === false && stage.kind !== "open") return "won_lost_active";
  if (patch.active === false && stage.active && activeOpen(stages, stageId).length === 0) {
    return "last_open";
  }
  return null;
}

/** Order after adding `newId`: right before the first won/lost stage (end of the open stages). */
export function orderWithNewStage(stages: readonly SetupStage[], newId: string): string[] {
  const ordered = [...stages]
    .filter((s) => s.id !== newId)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const firstClosed = ordered.findIndex((s) => s.kind !== "open");
  const ids = ordered.map((s) => s.id);
  ids.splice(firstClosed < 0 ? ids.length : firstClosed, 0, newId);
  return ids;
}

export type StageDbErrorCode =
  | "needs_open"
  | "needs_won"
  | "needs_lost"
  | "won_lost_fixed"
  | "target_required"
  | "invalid_target"
  | "not_found"
  | "invalid_order"
  | "forbidden"
  | "unknown";

/** Maps the exception messages raised by the stage guards / RPCs to stable codes. */
export function stageDbErrorCode(message: string | null | undefined): StageDbErrorCode {
  const m = (message ?? "").toLowerCase();
  if (m.includes("at least one active open stage")) return "needs_open";
  if (m.includes("exactly one won stage")) return "needs_won";
  if (m.includes("at least one lost stage")) return "needs_lost";
  if (m.includes("won and lost stages")) return "won_lost_fixed";
  if (m.includes("target_stage_required")) return "target_required";
  if (m.includes("target must be")) return "invalid_target";
  if (m.includes("stage_not_found")) return "not_found";
  if (m.includes("every stage of the pipeline")) return "invalid_order";
  if (m.includes("only a super admin") || m.includes("row-level security")) return "forbidden";
  return "unknown";
}
