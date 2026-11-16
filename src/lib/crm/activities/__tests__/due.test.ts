import { describe, expect, it } from "vitest";
import {
  addDays,
  completedSince,
  dayKey,
  dueBucket,
  dueRangeBounds,
  groupByDue,
  isOverdue,
  splitTimeline,
} from "../due";

// 2026-11-16 12:00 UTC = 09:00 in São Paulo (UTC-3) = 20:00 in Shanghai (UTC+8).
const NOW = new Date("2026-11-16T12:00:00Z");

describe("dueBucket", () => {
  it("separates overdue / today / next 7 days / later / none at day boundaries (UTC)", () => {
    expect(dueBucket(null, NOW, "UTC")).toBe("none");
    expect(dueBucket("2026-11-15T23:59:59Z", NOW, "UTC")).toBe("overdue");
    expect(dueBucket("2026-11-16T00:00:00Z", NOW, "UTC")).toBe("today");
    expect(dueBucket("2026-11-16T08:00:00Z", NOW, "UTC")).toBe("today"); // earlier today is not overdue
    expect(dueBucket("2026-11-16T23:59:59Z", NOW, "UTC")).toBe("today");
    expect(dueBucket("2026-11-17T00:00:00Z", NOW, "UTC")).toBe("next7");
    expect(dueBucket("2026-11-23T23:59:59Z", NOW, "UTC")).toBe("next7");
    expect(dueBucket("2026-11-24T00:00:00Z", NOW, "UTC")).toBe("later");
    expect(dueBucket("not a date", NOW, "UTC")).toBe("none");
  });

  it("uses the viewer's timezone for 'today'", () => {
    const due = "2026-11-16T02:00:00Z"; // 23:00 on Nov 15 in São Paulo, 10:00 on Nov 16 in Shanghai
    expect(dueBucket(due, NOW, "America/Sao_Paulo")).toBe("overdue");
    expect(dueBucket(due, NOW, "Asia/Shanghai")).toBe("today");
    const late = "2026-11-16T17:00:00Z"; // 14:00 Nov 16 São Paulo, 01:00 Nov 17 Shanghai
    expect(dueBucket(late, NOW, "America/Sao_Paulo")).toBe("today");
    expect(dueBucket(late, NOW, "Asia/Shanghai")).toBe("next7");
  });

  it("computes day keys and calendar arithmetic", () => {
    expect(dayKey(NOW, "Asia/Shanghai")).toBe("2026-11-16");
    expect(dayKey(new Date("2026-11-16T02:00:00Z"), "America/Sao_Paulo")).toBe("2026-11-15");
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
  });
});

describe("isOverdue", () => {
  it("only flags open activities due before today", () => {
    expect(isOverdue({ status: "open", due_at: "2026-11-10T10:00:00Z" }, NOW, "UTC")).toBe(true);
    expect(isOverdue({ status: "done", due_at: "2026-11-10T10:00:00Z" }, NOW, "UTC")).toBe(false);
    expect(isOverdue({ status: "open", due_at: null }, NOW, "UTC")).toBe(false);
  });
});

describe("groupByDue", () => {
  it("groups and sorts tasks", () => {
    const tasks = [
      { id: "a", due_at: "2026-11-20T10:00:00Z" },
      { id: "b", due_at: "2026-11-18T10:00:00Z" },
      { id: "c", due_at: null, created_at: "2026-11-01T00:00:00Z" },
      { id: "d", due_at: null, created_at: "2026-11-02T00:00:00Z" },
      { id: "e", due_at: "2026-11-01T10:00:00Z" },
      { id: "f", due_at: "2027-01-01T10:00:00Z" },
    ];
    const groups = groupByDue(tasks, NOW, "UTC");
    expect(groups.overdue.map((t) => t.id)).toEqual(["e"]);
    expect(groups.today).toEqual([]);
    expect(groups.next7.map((t) => t.id)).toEqual(["b", "a"]);
    expect(groups.later.map((t) => t.id)).toEqual(["f"]);
    expect(groups.none.map((t) => t.id)).toEqual(["d", "c"]);
  });

  it("keeps completed tasks of the last 14 days, newest first", () => {
    const done = [
      { id: "old", completed_at: "2026-11-01T11:59:59Z" },
      { id: "edge", completed_at: "2026-11-02T12:00:00Z" },
      { id: "new", completed_at: "2026-11-15T09:00:00Z" },
      { id: "none", completed_at: null },
    ];
    expect(completedSince(done, NOW).map((t) => t.id)).toEqual(["new", "edge"]);
  });
});

describe("splitTimeline", () => {
  it("puts open tasks/meetings first (soonest due) and merges the rest with audit events, newest first", () => {
    const activities = [
      { id: "t1", type: "task", status: "open", due_at: "2026-11-20T10:00:00Z", created_at: "2026-11-01T00:00:00Z" },
      { id: "m1", type: "meeting", status: "open", due_at: "2026-11-17T10:00:00Z", created_at: "2026-11-01T00:00:00Z" },
      { id: "t2", type: "task", status: "open", due_at: null, created_at: "2026-11-02T00:00:00Z" },
      { id: "c1", type: "call", status: "done", completed_at: "2026-11-10T10:00:00Z", created_at: "2026-11-10T10:00:00Z" },
      { id: "t3", type: "task", status: "done", completed_at: "2026-11-12T10:00:00Z", created_at: "2026-11-01T00:00:00Z" },
      { id: "n1", type: "note", status: "open", created_at: "2026-11-05T00:00:00Z" },
    ];
    const events = [{ kind: "audit" as const, id: "1", created_at: "2026-11-11T00:00:00Z" }];
    const { upcoming, past } = splitTimeline(activities, events);
    expect(upcoming.map((a) => a.id)).toEqual(["m1", "t1", "t2"]);
    expect(past.map((p) => p.item.id)).toEqual(["t3", "1", "c1", "n1"]);
  });
});

describe("dueRangeBounds", () => {
  it("returns rolling bounds", () => {
    expect(dueRangeBounds("overdue", NOW)).toEqual({ status: "open", to: "2026-11-16T12:00:00.000Z" });
    expect(dueRangeBounds("next7", NOW)).toEqual({ from: "2026-11-16T12:00:00.000Z", to: "2026-11-23T12:00:00.000Z" });
    expect(dueRangeBounds("later", NOW)).toEqual({ from: "2026-11-23T12:00:00.000Z" });
    expect(dueRangeBounds("none", NOW)).toEqual({ none: true });
    expect(dueRangeBounds("x", NOW)).toBeNull();
  });
});
