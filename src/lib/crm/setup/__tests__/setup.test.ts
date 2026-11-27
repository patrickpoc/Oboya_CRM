import { describe, expect, it } from "vitest";
import {
  actionsToLevel,
  countOverrides,
  levelToActions,
  normalizeOverrides,
  overrideCellState,
  serializeMatrix,
  toggleAction,
  toggleOverride,
} from "../matrix";
import {
  checkStageUpdate,
  isValidDeleteTarget,
  isValidReorder,
  moveById,
  moveItem,
  orderWithNewStage,
  planStageDelete,
  stageDbErrorCode,
  type SetupStage,
} from "../stages";
import { canAssignRole, checkUserUpdate, generateTemporaryPassword } from "../users";
import { slugifyPicklistValue } from "../picklists";
import { auditDateBounds, auditRecordHref, auditRecordLabel, diffEntries, resolveActorName } from "../audit";
import { accessControlPutSchema, leadAssignmentSchema, userPatchSchema } from "../schemas";
import { CRM_MODULES } from "@/lib/crm/types";

describe("matrix serialization", () => {
  it("canonicalizes levels", () => {
    expect(actionsToLevel([])).toBe("none");
    expect(actionsToLevel(["export", "view", "create", "edit", "delete", "convert"])).toBe("full");
    expect(actionsToLevel(["export", "view", "view"])).toEqual(["view", "export"]);
    expect(levelToActions("full")).toHaveLength(6);
    expect(levelToActions("none")).toEqual([]);
    expect(levelToActions(["bogus", "edit"])).toEqual(["edit"]);
  });

  it("toggles one action", () => {
    expect(toggleAction("none", "view")).toEqual(["view"]);
    expect(toggleAction(["view"], "view")).toBe("none");
    expect(toggleAction("full", "export")).toEqual(["view", "create", "edit", "delete", "convert"]);
  });

  it("writes every module for each role, super_admin always full, invalid roles dropped", () => {
    const out = serializeMatrix(
      { sales_rep: { leads: ["view"], home: "full" }, super_admin: { leads: "none" } },
      ["sales_rep", "super_admin", "Bad-Role"]
    );
    expect(Object.keys(out)).toEqual(["sales_rep", "super_admin"]);
    expect(Object.keys(out.sales_rep)).toEqual([...CRM_MODULES]);
    expect(out.sales_rep.leads).toEqual(["view"]);
    expect(out.sales_rep.accounts).toBe("none");
    expect(out.super_admin.leads).toBe("full");
    expect(accessControlPutSchema.safeParse({ matrix: out }).success).toBe(true);
  });

  it("rejects unknown modules/actions in the PUT body", () => {
    expect(accessControlPutSchema.safeParse({ matrix: { sales_rep: { widgets: "full" } } }).success).toBe(false);
    expect(accessControlPutSchema.safeParse({ matrix: { sales_rep: { leads: ["publish"] } } }).success).toBe(false);
  });
});

describe("user overrides", () => {
  it("normalizes and lets denies win", () => {
    const out = normalizeOverrides({
      grants: { leads: ["view", "delete"], bogus: "full", accounts: "none" },
      denies: { leads: ["delete"] },
    });
    expect(out).toEqual({ grants: { leads: ["view"] }, denies: { leads: ["delete"] } });
    expect(countOverrides(out)).toBe(2);
  });

  it("toggles relative to the role default", () => {
    const role = ["view"] as const;
    let o = toggleOverride({}, [...role], "leads", "view");
    expect(overrideCellState(o, [...role], "leads", "view")).toBe("denied");
    o = toggleOverride(o, [...role], "leads", "view");
    expect(o).toEqual({ grants: {}, denies: {} });
    o = toggleOverride(o, [...role], "leads", "delete");
    expect(overrideCellState(o, [...role], "leads", "delete")).toBe("granted");
  });
});

const stage = (id: string, kind: SetupStage["kind"], extra: Partial<SetupStage> = {}): SetupStage => ({
  id,
  label: id,
  probability: 0,
  sortOrder: 0,
  colorToken: null,
  kind,
  active: true,
  opportunityCount: 0,
  ...extra,
});

describe("stages", () => {
  const stages = [
    stage("a", "open", { sortOrder: 10, opportunityCount: 3 }),
    stage("b", "open", { sortOrder: 20 }),
    stage("c", "open", { sortOrder: 30, active: false }),
    stage("won", "won", { sortOrder: 40 }),
    stage("lost", "lost", { sortOrder: 50 }),
  ];

  it("reorders by drag and keyboard", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveById(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveById(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(moveById(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
  });

  it("validates a reorder like crm_reorder_stages", () => {
    expect(isValidReorder(["a", "b"], ["b", "a"])).toBe(true);
    expect(isValidReorder(["a", "b"], ["a", "a"])).toBe(false);
    expect(isValidReorder(["a", "b"], ["a"])).toBe(false);
    expect(isValidReorder(["a", "b"], ["a", "x"])).toBe(false);
  });

  it("plans deletes", () => {
    expect(planStageDelete(stages, "won")).toEqual({ ok: false, reason: "fixed_kind" });
    expect(planStageDelete(stages, "b")).toEqual({ ok: true, needsTarget: false });
    const plan = planStageDelete(stages, "a");
    expect(plan.ok && plan.needsTarget && plan.targets.map((s) => s.id)).toEqual(["b"]);
    expect(isValidDeleteTarget(stages, "a", "b")).toBe(true);
    expect(isValidDeleteTarget(stages, "a", "c")).toBe(false); // inactive
    expect(isValidDeleteTarget(stages, "a", "won")).toBe(false);
    expect(isValidDeleteTarget(stages, "a", "a")).toBe(false);
    expect(planStageDelete([stages[0], stages[3], stages[4]], "a")).toEqual({ ok: false, reason: "last_open" });
  });

  it("checks updates", () => {
    expect(checkStageUpdate(stages, "won", { active: false })).toBe("won_lost_active");
    expect(checkStageUpdate(stages, "won", { kind: "open" })).toBe("fixed_kind");
    expect(checkStageUpdate(stages, "a", { kind: "won" })).toBe("kind_change");
    expect(checkStageUpdate(stages, "a", { active: false })).toBeNull();
    expect(checkStageUpdate([stages[0], stages[3], stages[4]], "a", { active: false })).toBe("last_open");
    expect(checkStageUpdate(stages, "a", { label: "x" })).toBeNull();
  });

  it("puts a new stage before won/lost", () => {
    expect(orderWithNewStage([...stages, stage("new", "open", { sortOrder: 60 })], "new")).toEqual([
      "a",
      "b",
      "c",
      "new",
      "won",
      "lost",
    ]);
  });

  it("maps DB invariant errors", () => {
    expect(stageDbErrorCode("Pipeline needs at least one active open stage")).toBe("needs_open");
    expect(stageDbErrorCode("Won and lost stages cannot be removed")).toBe("won_lost_fixed");
    expect(stageDbErrorCode("target_stage_required")).toBe("target_required");
    expect(stageDbErrorCode("Target must be another active open stage of the same pipeline")).toBe(
      "invalid_target"
    );
    expect(stageDbErrorCode("whatever")).toBe("unknown");
  });
});

describe("user guard rails", () => {
  const admin = { id: "me", role: "super_admin" };

  it("blocks self demotion and self disable", () => {
    const target = { id: "me", role: "super_admin", status: "active" as const };
    expect(checkUserUpdate({ actor: admin, target, patch: { role: "sales_rep" }, activeSuperAdminIds: ["me", "x"] })).toBe(
      "self_role"
    );
    expect(
      checkUserUpdate({ actor: admin, target, patch: { status: "disabled" }, activeSuperAdminIds: ["me", "x"] })
    ).toBe("self_status");
    expect(
      checkUserUpdate({ actor: admin, target, patch: { role: "super_admin" }, activeSuperAdminIds: ["me"] })
    ).toBeNull();
  });

  it("keeps the last active super admin", () => {
    const target = { id: "other", role: "super_admin", status: "active" as const };
    expect(
      checkUserUpdate({ actor: admin, target, patch: { status: "disabled" }, activeSuperAdminIds: ["other"] })
    ).toBe("last_super_admin");
    expect(
      checkUserUpdate({ actor: admin, target, patch: { role: "sales_rep" }, activeSuperAdminIds: ["other", "me"] })
    ).toBeNull();
  });

  it("only super admins touch super admin access", () => {
    const actor = { id: "m", role: "sales_manager" };
    const rep = { id: "r", role: "sales_rep", status: "active" as const };
    expect(checkUserUpdate({ actor, target: rep, patch: { role: "super_admin" }, activeSuperAdminIds: [] })).toBe(
      "super_admin_only"
    );
    expect(checkUserUpdate({ actor, target: rep, patch: { role: "sales_manager" }, activeSuperAdminIds: [] })).toBeNull();
    expect(canAssignRole("sales_manager", "super_admin")).toBe(false);
    expect(canAssignRole("super_admin", "super_admin")).toBe(true);
  });

  it("generates unbiased temporary passwords", () => {
    const pw = generateTemporaryPassword(20);
    expect(pw).toHaveLength(20);
    expect(pw).toMatch(/^[A-HJ-NP-Za-km-z2-9!@#$%]+$/);
    // 62-char alphabet: bytes >= 248 are rejected, so 255 is skipped.
    const fixed = generateTemporaryPassword(2, (n) => Uint8Array.from({ length: n }, (_, i) => (i % 2 ? i : 255)));
    expect(fixed).toBe("BD");
  });

  it("validates the patch body", () => {
    expect(userPatchSchema.safeParse({ status: "disabled", receivesInbound: true }).success).toBe(true);
    expect(userPatchSchema.safeParse({ email: "x@y.z" }).success).toBe(false);
    expect(
      userPatchSchema.safeParse({ permissionOverrides: { grants: { leads: ["view"] }, extra: {} } }).success
    ).toBe(false);
  });
});

describe("picklists, lead assignment, audit", () => {
  it("slugifies labels", () => {
    expect(slugifyPicklistValue("Trade Show 2027!")).toBe("trade_show_2027");
    expect(slugifyPicklistValue("Key Account", "tag")).toBe("key-account");
    expect(slugifyPicklistValue("Café Grower")).toBe("cafe_grower");
  });

  it("requires a default owner in default_owner mode", () => {
    expect(leadAssignmentSchema.safeParse({ mode: "default_owner", defaultOwnerId: null }).success).toBe(false);
    expect(leadAssignmentSchema.safeParse({ mode: "round_robin", defaultOwnerId: null }).success).toBe(true);
  });

  it("renders diffs and links", () => {
    expect(diffEntries({ stage_id: ["a", "b"], amount: [null, 10], bad: "x" })).toEqual([
      { field: "amount", before: null, after: 10 },
      { field: "stage_id", before: "a", after: "b" },
    ]);
    expect(auditRecordHref("opportunity", "123")).toBe("/opportunities/123");
    expect(auditRecordHref("nope", "1")).toBeNull();
    expect(auditRecordHref("entity", "123")).toBeNull();
    expect(auditRecordHref("lead", null)).toBeNull();
    expect(auditRecordLabel("12345678-aaaa", null)).toBe("12345678");
    expect(auditRecordLabel(null, "sales_rep")).toBe("sales_rep");
    const names = new Map([["u1", "Ana"]]);
    expect(resolveActorName("u1", "Old name", names)).toBe("Ana");
    expect(resolveActorName("u2", "Old name", names)).toBe("Old name");
    expect(resolveActorName(null, null, names)).toBe("system");
  });

  it("builds inclusive date bounds", () => {
    expect(auditDateBounds("2026-11-01", "2026-11-30")).toEqual({
      gte: "2026-11-01T00:00:00.000Z",
      lt: "2026-12-01T00:00:00.000Z",
    });
    expect(auditDateBounds("bad", "")).toEqual({});
  });
});
