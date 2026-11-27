import { describe, expect, it } from "vitest";
import { dueDateFromDays, isStalled, isTaskOverdue, lastTouch, stalledAgeDays } from "../due";

const now = new Date("2026-11-27T12:00:00Z");

describe("due helpers", () => {
  it("adds dueInDays and clamps to 0-365", () => {
    expect(dueDateFromDays(0, now)).toEqual(now);
    expect(dueDateFromDays(3, now).toISOString()).toBe("2026-11-30T12:00:00.000Z");
    expect(dueDateFromDays(-5, now)).toEqual(now);
    expect(dueDateFromDays(9999, now).getTime() - now.getTime()).toBe(365 * 86_400_000);
  });
  it("takes the latest touch and computes age", () => {
    const entered = new Date("2026-11-01T00:00:00Z");
    const activity = new Date("2026-11-10T00:00:00Z");
    expect(lastTouch(entered, activity)).toEqual(activity);
    expect(lastTouch(entered, null)).toEqual(entered);
    expect(lastTouch(entered, new Date("2026-10-01T00:00:00Z"))).toEqual(entered);
    expect(stalledAgeDays(entered, now)).toBe(26);
    expect(stalledAgeDays(new Date("2027-01-01"), now)).toBe(0);
  });
  it("flags stalled at the threshold", () => {
    expect(isStalled(new Date("2026-11-13T12:00:00Z"), now, 14)).toBe(true);
    expect(isStalled(new Date("2026-11-14T12:00:00Z"), now, 14)).toBe(false);
  });
  it("overdue respects the grace hours", () => {
    const due = new Date("2026-11-27T10:00:00Z");
    expect(isTaskOverdue(due, now, 0)).toBe(true);
    expect(isTaskOverdue(due, now, 2)).toBe(false);
    expect(isTaskOverdue(due, now, 1)).toBe(true);
    expect(isTaskOverdue(null, now, 0)).toBe(false);
  });
});
