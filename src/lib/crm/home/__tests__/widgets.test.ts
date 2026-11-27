import { describe, expect, it } from "vitest";
import { HomeWidgetSchema } from "@/lib/crm/reports/definition";
import { availableBuiltins, BUILTIN_WIDGET_REGISTRY, defaultHomeLayout, moveWidget } from "../widgets";

describe("home widgets", () => {
  it("registry covers every built-in id", () => {
    expect(BUILTIN_WIDGET_REGISTRY).toHaveLength(8);
  });
  it("default layout respects permissions and validates", () => {
    const layout = defaultHomeLayout((m) => m === "home" || m === "leads");
    expect(layout.map((w) => w.ref)).toEqual(["kpi_open_leads", "recent_records", "quick_access"]);
    expect(layout.every((w) => HomeWidgetSchema.safeParse(w).success)).toBe(true);
    expect(layout.map((w) => w.position)).toEqual([0, 1, 2]);
  });
  it("lists only unused permitted built-ins", () => {
    const used = [{ kind: "builtin", ref: "my_tasks" }];
    const ids = availableBuiltins(used, () => true).map((w) => w.id);
    expect(ids).not.toContain("my_tasks");
    expect(ids).toHaveLength(7);
  });
  it("moves and clamps", () => {
    const items = [0, 1, 2].map((p) => ({ id: String(p), position: p }));
    expect(moveWidget(items, 0, 1).map((i) => i.id)).toEqual(["1", "0", "2"]);
    expect(moveWidget(items, 0, -1).map((i) => i.id)).toEqual(["0", "1", "2"]);
  });
});

import { moveWidgetById, removeWidgetById, patchWidgetById } from "../widgets";

describe("draft helpers keep hidden widgets", () => {
  const draft = ["a", "hidden", "b", "c"].map((id, position) => ({ id, position, size: "sm" }));
  const visible = ["a", "b", "c"];
  it("swaps with the visible neighbour, hidden stays", () => {
    const next = moveWidgetById(draft, visible, "b", -1);
    expect(next).toHaveLength(4);
    expect(next.find((w) => w.id === "hidden")?.position).toBe(1);
    expect(next.find((w) => w.id === "b")?.position).toBe(0);
    expect(next.find((w) => w.id === "a")?.position).toBe(2);
  });
  it("does nothing at the edge", () => {
    expect(moveWidgetById(draft, visible, "a", -1).map((w) => w.id)).toEqual(["a", "hidden", "b", "c"]);
  });
  it("remove and patch work by id", () => {
    expect(removeWidgetById(draft, "b").map((w) => w.id)).toEqual(["a", "hidden", "c"]);
    expect(patchWidgetById(draft, "c", { size: "lg" }).find((w) => w.id === "c")?.size).toBe("lg");
    expect(removeWidgetById(draft, "b").some((w) => w.id === "hidden")).toBe(true);
  });
});
