import { describe, expect, it } from "vitest";
import {
  alertRuleSchema,
  assignmentRuleSchema,
  stageTaskSchema,
} from "../schemas";

const U = "11111111-1111-4111-8111-111111111111";
const base = { name: "BR", targetType: "user" as const, targetUserId: U };

describe("assignmentRuleSchema", () => {
  it("applies defaults and normalises country codes", () => {
    const r = assignmentRuleSchema.parse({ ...base, countryCodes: [" br", "BR", "pt"] });
    expect(r.countryCodes).toEqual(["BR", "PT"]);
    expect(r.active).toBe(true);
    expect(r.sources).toEqual([]);
  });
  it("rejects non ISO-2 countries", () => {
    expect(assignmentRuleSchema.safeParse({ ...base, countryCodes: ["BRA"] }).success).toBe(false);
  });
  it("requires a user for user targets and a pool for round_robin", () => {
    expect(assignmentRuleSchema.safeParse({ ...base, targetUserId: null }).success).toBe(false);
    expect(assignmentRuleSchema.safeParse({ name: "x", targetType: "round_robin" }).success).toBe(false);
    expect(assignmentRuleSchema.safeParse({ name: "x", targetType: "round_robin", poolUserIds: [U] }).success).toBe(true);
  });
  it("caps the pool at 50", () => {
    const pool = Array.from({ length: 51 }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`);
    expect(assignmentRuleSchema.safeParse({ name: "x", targetType: "round_robin", poolUserIds: pool }).success).toBe(false);
    expect(assignmentRuleSchema.safeParse({ name: "x", targetType: "round_robin", poolUserIds: pool.slice(0, 50) }).success).toBe(true);
  });
});

describe("stageTaskSchema", () => {
  const ok = { stageId: U, pipelineId: U, subject: "Call", dueInDays: 3 };
  it("enforces limits", () => {
    expect(stageTaskSchema.safeParse(ok).success).toBe(true);
    expect(stageTaskSchema.safeParse({ ...ok, subject: "" }).success).toBe(false);
    expect(stageTaskSchema.safeParse({ ...ok, subject: "x".repeat(301) }).success).toBe(false);
    expect(stageTaskSchema.safeParse({ ...ok, dueInDays: 366 }).success).toBe(false);
    expect(stageTaskSchema.safeParse({ ...ok, dueInDays: -1 }).success).toBe(false);
  });
  it("requires a user when assigneeType is user", () => {
    expect(stageTaskSchema.safeParse({ ...ok, assigneeType: "user" }).success).toBe(false);
    expect(stageTaskSchema.safeParse({ ...ok, assigneeType: "user", assigneeUserId: U }).success).toBe(true);
  });
});

describe("alertRuleSchema", () => {
  it("validates kind and threshold", () => {
    expect(alertRuleSchema.safeParse({ kind: "stalled_deal", threshold: 14 }).success).toBe(true);
    expect(alertRuleSchema.safeParse({ kind: "nope", threshold: 1 }).success).toBe(false);
    expect(alertRuleSchema.safeParse({ kind: "overdue_task", threshold: -1 }).success).toBe(false);
  });
});
