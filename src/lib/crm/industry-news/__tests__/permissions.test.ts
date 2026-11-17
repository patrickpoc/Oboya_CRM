import { describe, expect, it } from "vitest";
import { canManageIndustryNews } from "../permissions";

describe("Industry News management permission", () => {
  it("allows only super admins to change the shared feed", () => {
    expect(canManageIndustryNews({ role: "super_admin" })).toBe(true);
    expect(canManageIndustryNews({ role: "sales_manager" })).toBe(false);
    expect(canManageIndustryNews({ role: "sales_rep" })).toBe(false);
    expect(canManageIndustryNews({ role: "read_only" })).toBe(false);
  });
});
