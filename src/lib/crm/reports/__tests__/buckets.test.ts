import { describe, expect, it } from "vitest";
import { bucketKey, bucketLabel, isoWeek, localDay } from "../buckets";

const SP = "America/Sao_Paulo";
const SH = "Asia/Shanghai";
const NY = "America/New_York";

describe("bucketKey", () => {
  it("moves instants across local midnight in Sao Paulo (UTC-3)", () => {
    expect(bucketKey("2026-03-01T02:59:00Z", "day", SP)).toBe("2026-02-28");
    expect(bucketKey("2026-03-01T03:00:00Z", "day", SP)).toBe("2026-03-01");
    expect(bucketKey("2026-03-01T02:59:00Z", "month", SP)).toBe("2026-02");
  });

  it("moves instants across local midnight in Shanghai (UTC+8) and the year", () => {
    expect(bucketKey("2026-12-31T15:59:00Z", "day", SH)).toBe("2026-12-31");
    expect(bucketKey("2026-12-31T16:00:00Z", "day", SH)).toBe("2027-01-01");
    expect(bucketKey("2026-12-31T16:00:00Z", "year", SH)).toBe("2027");
    expect(bucketKey("2026-12-31T16:00:00Z", "quarter", SH)).toBe("2027-Q1");
    expect(bucketKey("2026-12-31T15:59:00Z", "quarter", SH)).toBe("2026-Q4");
  });

  it("follows DST transitions (New York)", () => {
    // Spring forward 2026-03-08 02:00 local: midnight is still UTC-5.
    expect(bucketKey("2026-03-08T04:59:00Z", "day", NY)).toBe("2026-03-07");
    expect(bucketKey("2026-03-08T05:00:00Z", "day", NY)).toBe("2026-03-08");
    // Fall back 2026-11-01: the day lasts 25 hours, midnight 2026-11-02 is UTC-5.
    expect(bucketKey("2026-11-02T04:59:00Z", "day", NY)).toBe("2026-11-01");
    expect(bucketKey("2026-11-02T05:00:00Z", "day", NY)).toBe("2026-11-02");
  });

  it("keeps plain dates untouched by the timezone", () => {
    expect(bucketKey("2026-03-01", "day", SP)).toBe("2026-03-01");
    expect(localDay("2026-03-01", SH)).toBe("2026-03-01");
  });

  it("uses ISO weeks (Monday first, week 1 holds the first Thursday)", () => {
    expect(isoWeek("2024-12-30")).toEqual({ year: 2025, week: 1 });
    expect(isoWeek("2021-01-03")).toEqual({ year: 2020, week: 53 });
    // 2027-01-01 (Friday) still belongs to 2026-W53.
    expect(bucketKey("2026-12-31T16:00:00Z", "week", SH)).toBe("2026-W53");
    expect(bucketKey("2026-01-05", "week", "UTC")).toBe("2026-W02");
  });

  it("sorts keys chronologically as strings", () => {
    const keys = ["2026-W09", "2026-W10", "2025-W52"].sort();
    expect(keys).toEqual(["2025-W52", "2026-W09", "2026-W10"]);
    expect(["2026-Q2", "2025-Q4", "2026-Q1"].sort()).toEqual(["2025-Q4", "2026-Q1", "2026-Q2"]);
  });

  it("returns null for empty or invalid values", () => {
    expect(bucketKey(null, "day", SP)).toBeNull();
    expect(bucketKey("nope", "month", SP)).toBeNull();
  });
});

describe("bucketLabel", () => {
  it("formats in the user's locale", () => {
    expect(bucketLabel("2026-03", "month", "en")).toBe("March 2026");
    expect(bucketLabel("2026-03", "month", "pt-BR")).toMatch(/março/i);
    expect(bucketLabel("2026-Q2", "quarter", "en")).toBe("Q2 2026");
    expect(bucketLabel("2026", "year", "es")).toBe("2026");
    expect(bucketLabel("2026-W02", "week", "en")).toContain("Jan 5, 2026");
  });
});
