import { describe, expect, it } from "vitest";
import { requireRecordConfig } from "@/lib/crm/objects/registry";
import { joinSecondary, normalizeSearchQuery, searchFilter, seeAllHref } from "../query";

describe("normalizeSearchQuery", () => {
  it("trims, collapses whitespace and enforces the 2-char minimum", () => {
    expect(normalizeSearchQuery("  acme   corp ")).toBe("acme corp");
    expect(normalizeSearchQuery("a")).toBeNull();
    expect(normalizeSearchQuery(" a ")).toBeNull();
    expect(normalizeSearchQuery("ab")).toBe("ab");
    expect(normalizeSearchQuery(undefined)).toBeNull();
  });
  it("drops control characters and the PostgREST * wildcard", () => {
    expect(normalizeSearchQuery("ac\u0000me*")).toBe("ac me");
    expect(normalizeSearchQuery("**")).toBeNull();
  });
  it("caps the length at 100", () => {
    expect(normalizeSearchQuery("x".repeat(300))).toHaveLength(100);
  });
});

describe("searchFilter", () => {
  const account = requireRecordConfig("account");
  it("builds a quoted ilike or-filter over searchable columns", () => {
    const filter = searchFilter(account, "acme")!;
    expect(filter).toContain('name.ilike."%acme%"');
    expect(filter.split(",").every((part) => part.includes(".ilike."))).toBe(true);
  });
  it("escapes LIKE metacharacters and quotes PostgREST specials", () => {
    const filter = searchFilter(account, '50%_off\\"x,y)')!;
    expect(filter).toContain('name.ilike."%50\\\\%\\\\_off\\\\\\\\\\"x,y)%"');
  });
});

describe("helpers", () => {
  it("joins non-empty secondary parts", () => {
    expect(joinSecondary(["Acme", "", null, "a@b.co", 0])).toBe("Acme · a@b.co · 0");
  });
  it("links to the list with view=all and q", () => {
    expect(seeAllHref("/accounts", "acme & co")).toBe("/accounts?view=all&q=acme+%26+co");
  });
});
