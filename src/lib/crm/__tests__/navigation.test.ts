import { describe, expect, it } from "vitest";
import roadmapMessages from "../../../../messages/en/roadmap.json";
import navMessages from "../../../../messages/en/nav.json";
import {
  badgeTotal,
  crmNavigation,
  filterNavigation,
  findActiveHref,
  flattenNavigation,
  getBreadcrumbs,
} from "@/lib/crm/navigation";
import { roadmap } from "@/lib/crm/roadmap";
import type { CrmModule } from "@/lib/crm/types";

const hrefs = (items = crmNavigation) => flattenNavigation(items).map((item) => item.href);

describe("roadmap registry", () => {
  it("has the 15 roadmap modules with full copy", () => {
    expect(roadmap).toHaveLength(15);
    const modules = roadmapMessages.modules as Record<
      string,
      { title: string; description: string; capabilities: Record<string, string>; dependencies: Record<string, string> }
    >;
    for (const entry of roadmap) {
      const copy = modules[entry.id];
      expect(copy?.title, entry.id).toBeTruthy();
      expect(copy.description.length).toBeGreaterThan(100);
      expect(entry.capabilityKeys.length).toBeGreaterThanOrEqual(4);
      expect(entry.capabilityKeys.length).toBeLessThanOrEqual(6);
      expect(Object.keys(copy.capabilities).sort()).toEqual([...entry.capabilityKeys].sort());
      expect(Object.keys(copy.dependencies).sort()).toEqual([...entry.dependencyKeys].sort());
      for (const dep of entry.dependencyKeys) {
        const isModule = roadmap.some((other) => other.id === dep);
        expect(isModule || dep in roadmapMessages.external, `${entry.id} -> ${dep}`).toBe(true);
      }
    }
  });

  it("puts every planned module in the sidebar with a Soon flag", () => {
    const flat = flattenNavigation(crmNavigation);
    for (const entry of roadmap.filter((candidate) => candidate.status === "planned")) {
      const item = flat.find((i) => i.href === entry.href);
      expect(item?.soon, entry.id).toBe(true);
    }
  });

  it("puts live modules in the sidebar with their permission module", () => {
    const flat = flattenNavigation(crmNavigation);
    for (const entry of roadmap.filter((candidate) => candidate.status === "live")) {
      const item = flat.find((i) => i.href === entry.href);
      expect(item?.module, entry.id).toBe(entry.module);
      expect(item?.soon, entry.id).toBeFalsy();
    }
  });
});

describe("navigation", () => {
  it("has a nav label for every item", () => {
    const walk = (items = crmNavigation): string[] =>
      items.flatMap((i) => [i.labelKey, ...walk(i.children ?? [])]);
    for (const key of walk()) expect(navMessages, key).toHaveProperty([key]);
  });

  it("filters items by can(module, 'view') and drops empty groups", () => {
    const allowed = new Set<CrmModule>(["home", "leads"]);
    const items = filterNavigation(crmNavigation, (m) => allowed.has(m));
    const visible = hrefs(items);
    expect(visible).toContain("/dashboard");
    expect(visible).toContain("/leads");
    expect(visible).not.toContain("/accounts");
    expect(visible).toContain("/quotes"); // planned modules are visible to everyone
    expect(items.find((i) => i.labelKey === "setup")).toBeUndefined();
  });

  it("matches the deepest href and builds breadcrumbs", () => {
    expect(findActiveHref("/opportunities/pipeline")).toBe("/opportunities/pipeline");
    expect(findActiveHref("/opportunities/123")).toBe("/opportunities");
    expect(getBreadcrumbs("/opportunities/pipeline").map((c) => c.labelKey)).toEqual([
      "home",
      "sales",
      "opportunities",
      "pipeline",
    ]);
    expect(getBreadcrumbs("/leads/abc").map((c) => c.labelKey)).toEqual([
      "home",
      "sales",
      "leads",
      "detail",
    ]);
  });

  it("sums badges of a group", () => {
    const sales = crmNavigation.find((i) => i.labelKey === "sales")!;
    expect(badgeTotal(sales, { leadsNew: 3, tasksDue: 2 })).toBe(5);
    expect(badgeTotal(sales, {})).toBe(0);
  });
});
