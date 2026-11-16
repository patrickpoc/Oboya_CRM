import { describe, expect, it } from "vitest";
import { dayBounds, isValidTimeZone, monthBounds, safeTimeZone, zonedMidnight } from "../time";

describe("timezone validation", () => {
  it("accepts IANA zones and falls back to UTC", () => {
    expect(isValidTimeZone("America/Sao_Paulo")).toBe(true);
    expect(isValidTimeZone("Not/AZone")).toBe(false);
    expect(safeTimeZone("x".repeat(100))).toBe("UTC");
    expect(safeTimeZone(undefined)).toBe("UTC");
  });
});

describe("zonedMidnight", () => {
  it("returns the UTC instant of local midnight", () => {
    expect(zonedMidnight("2026-11-16", "UTC").toISOString()).toBe("2026-11-16T00:00:00.000Z");
    expect(zonedMidnight("2026-11-16", "America/Sao_Paulo").toISOString()).toBe("2026-11-16T03:00:00.000Z");
    expect(zonedMidnight("2026-11-16", "Asia/Shanghai").toISOString()).toBe("2026-11-15T16:00:00.000Z");
  });
  it("handles DST (Europe/Lisbon: UTC+1 in summer, UTC+0 in winter)", () => {
    expect(zonedMidnight("2026-07-01", "Europe/Lisbon").toISOString()).toBe("2026-06-30T23:00:00.000Z");
    expect(zonedMidnight("2026-11-01", "Europe/Lisbon").toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });
});

describe("dayBounds", () => {
  it("uses the viewer's calendar day", () => {
    // 2026-11-16 02:00 UTC is still Nov 15 in São Paulo.
    const now = new Date("2026-11-16T02:00:00Z");
    const sp = dayBounds(now, "America/Sao_Paulo");
    expect(sp.start.toISOString()).toBe("2026-11-15T03:00:00.000Z");
    expect(sp.end.toISOString()).toBe("2026-11-16T03:00:00.000Z");
    expect(dayBounds(now, "UTC").start.toISOString()).toBe("2026-11-16T00:00:00.000Z");
  });
});

describe("monthBounds", () => {
  it("spans the local month, including the year rollover", () => {
    const nov = monthBounds(new Date("2026-11-16T12:00:00Z"), "UTC");
    expect(nov.start.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(nov.end.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    const dec = monthBounds(new Date("2026-12-31T12:00:00Z"), "UTC");
    expect(dec.end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
  it("first hours of a month in UTC can still be the previous month locally", () => {
    // Dec 1 01:00 UTC = Nov 30 22:00 in São Paulo.
    const b = monthBounds(new Date("2026-12-01T01:00:00Z"), "America/Sao_Paulo");
    expect(b.start.toISOString()).toBe("2026-11-01T03:00:00.000Z");
    expect(b.end.toISOString()).toBe("2026-12-01T03:00:00.000Z");
  });
});
