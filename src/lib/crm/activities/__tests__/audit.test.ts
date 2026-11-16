import { describe, expect, it } from "vitest";
import { toTimelineEvent, type AuditRow } from "@/lib/crm/activities/audit";

const row = (action: string, diff: Record<string, unknown>): AuditRow => ({
  id: 1,
  action,
  actor_name: "Ana",
  diff,
  created_at: "2026-11-16T12:00:00Z",
});

describe("toTimelineEvent", () => {
  const users = new Map([["u1", "Ana"], ["u2", "Bo"]]);
  const stages = new Map([["s1", "Prospecting"], ["s2", "Proposal"]]);

  it("reads lead status changes as stage changes (raw values for the UI)", () => {
    expect(toTimelineEvent("lead", row("stage_change", { status: ["new", "working"] }), users, stages)).toMatchObject({
      action: "stage_change",
      from: "new",
      to: "working",
      values: "lead_status",
    });
  });

  it("labels opportunity stages and owners", () => {
    expect(toTimelineEvent("opportunity", row("stage_change", { stage_id: ["s1", "s2"] }), users, stages)).toMatchObject({
      from: "Prospecting",
      to: "Proposal",
    });
    const owner = toTimelineEvent("lead", row("owner_change", { owner_id: ["u1", "u2"] }), users, stages);
    expect(owner).toMatchObject({ from: "Ana", to: "Bo" });
    expect(owner.values).toBeUndefined();
    expect(toTimelineEvent("account", row("create", {}), users, stages)).toMatchObject({ from: null, to: null });
  });
});
