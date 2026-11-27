import { describe, expect, it } from "vitest";
import { NOTIFICATION_KINDS, NOTIFICATION_KIND_META } from "../kinds";
import { markReadSchema, notificationsQuerySchema } from "../schemas";

const U = "11111111-1111-4111-8111-111111111111";

describe("notification kinds", () => {
  it("maps every kind with keys, icon and href", () => {
    expect(Object.keys(NOTIFICATION_KIND_META).sort()).toEqual([...NOTIFICATION_KINDS].sort());
    for (const k of NOTIFICATION_KINDS) {
      const m = NOTIFICATION_KIND_META[k];
      expect(m.titleKey && m.bodyKey && m.icon).toBeTruthy();
    }
    expect(NOTIFICATION_KIND_META.lead_assigned.href("lead", "abc")).toBe("/leads/abc");
    expect(NOTIFICATION_KIND_META.stalled_deal.href("opportunity", "o1")).toBe("/opportunities/o1");
  });
});

describe("notification schemas", () => {
  it("limits the list query to 50", () => {
    expect(notificationsQuerySchema.parse({}).limit).toBe(20);
    expect(notificationsQuerySchema.parse({ limit: "50" }).limit).toBe(50);
    expect(notificationsQuerySchema.safeParse({ limit: "51" }).success).toBe(false);
  });
  it("accepts mark-read as ids or all, not both or empty", () => {
    expect(markReadSchema.safeParse({ ids: [U] }).success).toBe(true);
    expect(markReadSchema.safeParse({ all: true }).success).toBe(true);
    expect(markReadSchema.safeParse({ all: false }).success).toBe(false);
    expect(markReadSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(markReadSchema.safeParse({ ids: [U], all: true }).success).toBe(false);
    expect(markReadSchema.safeParse({ ids: Array(101).fill(U) }).success).toBe(false);
  });
});
