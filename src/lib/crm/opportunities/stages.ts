/**
 * Opportunity stage transition rules (pure, client-safe). Used by
 * POST /api/crm/opportunities/[id]/stage and by the kanban/path for optimistic
 * updates. The DB trigger crm_opportunity_stage_rules enforces the same
 * invariants (lost needs loss_reason, closed_at stamping).
 *
 * Probability rule: a probability is "overridden" when it differs from the
 * default of the stage the opportunity is currently in, and that stage is open.
 * - An explicit `probability` in the request always wins.
 * - Moving to a won/lost stage always applies that stage's default.
 * - Moving to another open stage keeps an overridden probability; otherwise
 *   the target stage's default applies.
 *
 * Loss fields: entering (or staying in) a lost stage requires a loss reason
 * (the request's, or the existing one when already lost). Any other stage
 * clears loss_reason and loss_note (reopening).
 */

export type StageKind = "open" | "won" | "lost";

export type StageInfo = { id: string; kind: StageKind; probability: number };

export type OpportunityStageState = {
  stageId: string;
  probability: number | null;
  lossReason: string | null;
  lossNote: string | null;
};

export type StageChangeInput = {
  stageId: string;
  lossReason?: string | null;
  lossNote?: string | null;
  probability?: number | null;
};

export type StagePatch = {
  stage_id: string;
  probability: number;
  loss_reason: string | null;
  loss_note: string | null;
};

export type StageChangePlan =
  | { ok: true; patch: StagePatch; changed: boolean; stageChanged: boolean }
  | { ok: false; error: "loss_reason_required" };

function clean(value: string | null | undefined): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" ? null : text;
}

export function isProbabilityOverridden(state: OpportunityStageState, currentStage: StageInfo | null): boolean {
  if (!currentStage || currentStage.kind !== "open") return false;
  return state.probability !== null && state.probability !== currentStage.probability;
}

export function nextProbability(
  state: OpportunityStageState,
  currentStage: StageInfo | null,
  target: StageInfo,
  explicit?: number | null
): number {
  if (typeof explicit === "number") return explicit;
  if (target.kind !== "open") return target.probability;
  if (currentStage?.id === target.id && state.probability !== null) return state.probability;
  return isProbabilityOverridden(state, currentStage) ? state.probability! : target.probability;
}

/** Plans the update for a stage change (or a loss-reason edit on a lost stage). */
export function planStageChange(
  state: OpportunityStageState,
  currentStage: StageInfo | null,
  target: StageInfo,
  input: StageChangeInput
): StageChangePlan {
  const wasLost = currentStage?.kind === "lost";
  let lossReason: string | null = null;
  let lossNote: string | null = null;
  if (target.kind === "lost") {
    lossReason = clean(input.lossReason) ?? (wasLost ? clean(state.lossReason) : null);
    if (!lossReason) return { ok: false, error: "loss_reason_required" };
    lossNote = input.lossNote !== undefined ? clean(input.lossNote) : wasLost ? clean(state.lossNote) : null;
  }

  const patch: StagePatch = {
    stage_id: target.id,
    probability: nextProbability(state, currentStage, target, input.probability),
    loss_reason: lossReason,
    loss_note: lossNote,
  };
  const stageChanged = state.stageId !== target.id;
  const changed =
    stageChanged ||
    patch.probability !== state.probability ||
    patch.loss_reason !== state.lossReason ||
    patch.loss_note !== state.lossNote;
  return { ok: true, patch, changed, stageChanged };
}

/** Stage kind per row id from its `stage_id` and a stage id -> kind map (rows without a known stage are skipped). */
export function stageKindsFromRows(
  rows: ReadonlyArray<{ id: string; stage_id?: unknown }>,
  kinds: ReadonlyMap<string, string>
): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) {
    const kind = typeof row.stage_id === "string" ? kinds.get(row.stage_id) : undefined;
    if (kind) out.set(row.id, kind);
  }
  return out;
}
