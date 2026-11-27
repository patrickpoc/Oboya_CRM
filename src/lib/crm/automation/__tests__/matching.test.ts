import { describe, expect, it } from "vitest";
import { nextRoundRobin, orderRules, resolveAssignment, ruleMatches, type MatchableRule } from "../matching";

const rule = (o: Partial<MatchableRule> & { id: string }): MatchableRule => ({
  active: true,
  sortOrder: 0,
  countryCodes: [],
  entityIds: [],
  sources: [],
  targetType: "user",
  targetUserId: "u1",
  poolUserIds: [],
  stopProcessing: false,
  ...o,
});
const ctx = (eligible: string[], cursors = {}) => ({
  eligibleUserIds: new Set(eligible),
  cursors,
  fallback: { ownerId: "fb", via: "default" as const },
});

describe("ruleMatches", () => {
  it("empty criteria match anything, even null values", () => {
    expect(ruleMatches(rule({ id: "a" }), {})).toBe(true);
  });
  it("compares country case-insensitively", () => {
    expect(ruleMatches(rule({ id: "a", countryCodes: ["BR"] }), { countryCode: "br" })).toBe(true);
    expect(ruleMatches(rule({ id: "a", countryCodes: ["BR"] }), { countryCode: "US" })).toBe(false);
  });
  it("null never matches a non-empty criterion", () => {
    expect(ruleMatches(rule({ id: "a", countryCodes: ["BR"] }), { countryCode: null })).toBe(false);
    expect(ruleMatches(rule({ id: "a", sources: ["web"] }), {})).toBe(false);
    expect(ruleMatches(rule({ id: "a", entityIds: ["e1"] }), { entityId: null })).toBe(false);
  });
  it("requires every criterion and an active rule", () => {
    const r = rule({ id: "a", countryCodes: ["BR"], sources: ["web"] });
    expect(ruleMatches(r, { countryCode: "BR", source: "web" })).toBe(true);
    expect(ruleMatches(r, { countryCode: "BR", source: "fair" })).toBe(false);
    expect(ruleMatches({ ...r, active: false }, { countryCode: "BR", source: "web" })).toBe(false);
  });
});

describe("nextRoundRobin", () => {
  const pool = ["a", "b", "c"];
  const all = new Set(pool);
  it("starts at the first member without a cursor", () => expect(nextRoundRobin(pool, all, null)).toBe("a"));
  it("advances and wraps", () => {
    expect(nextRoundRobin(pool, all, "a")).toBe("b");
    expect(nextRoundRobin(pool, all, "c")).toBe("a");
  });
  it("skips ineligible members", () => {
    expect(nextRoundRobin(pool, new Set(["a", "c"]), "a")).toBe("c");
    expect(nextRoundRobin(pool, new Set(["a"]), "a")).toBe("a");
  });
  it("restarts when the cursor left the pool; null when nobody is eligible", () => {
    expect(nextRoundRobin(pool, all, "zz")).toBe("a");
    expect(nextRoundRobin(pool, new Set(), null)).toBeNull();
    expect(nextRoundRobin([], all, null)).toBeNull();
  });
});

describe("resolveAssignment", () => {
  it("evaluates by sort_order", () => {
    const rules = [rule({ id: "late", sortOrder: 2, targetUserId: "u2" }), rule({ id: "early", sortOrder: 1, targetUserId: "u1" })];
    expect(orderRules(rules).map((r) => r.id)).toEqual(["early", "late"]);
    expect(resolveAssignment(rules, {}, ctx(["u1", "u2"]))).toMatchObject({ ownerId: "u1", ruleId: "early", via: "rule" });
  });
  it("tries the next rule when the target is ineligible and stop_processing is off", () => {
    const rules = [rule({ id: "r1", sortOrder: 1, targetUserId: "gone" }), rule({ id: "r2", sortOrder: 2, targetUserId: "u2" })];
    expect(resolveAssignment(rules, {}, ctx(["u2"]))).toMatchObject({ ownerId: "u2", ruleId: "r2" });
  });
  it("falls back when a matching rule has no assignee and stop_processing is on", () => {
    const rules = [rule({ id: "r1", sortOrder: 1, targetUserId: "gone", stopProcessing: true }), rule({ id: "r2", sortOrder: 2 })];
    expect(resolveAssignment(rules, {}, ctx(["u1"]))).toEqual({ ownerId: "fb", ruleId: null, via: "default" });
  });
  it("uses the fallback when nothing matches", () => {
    expect(resolveAssignment([rule({ id: "r", countryCodes: ["BR"] })], { countryCode: "US" }, ctx(["u1"]))).toMatchObject({
      ownerId: "fb",
      ruleId: null,
    });
  });
  it("round-robin uses the cursor and reports the new one", () => {
    const rr = rule({ id: "rr", targetType: "round_robin", targetUserId: null, poolUserIds: ["a", "b"] });
    expect(resolveAssignment([rr], {}, ctx(["a", "b"], { rr: "a" }))).toEqual({
      ownerId: "b",
      ruleId: "rr",
      via: "round_robin",
      cursor: { ruleId: "rr", userId: "b" },
    });
  });
});
