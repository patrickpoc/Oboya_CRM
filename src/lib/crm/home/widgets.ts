import {
  BUILTIN_HOME_WIDGETS,
  type BuiltinHomeWidget,
  type HomeWidget,
  type WidgetSize,
} from "@/lib/crm/reports/definition";
import type { CrmModule } from "@/lib/crm/types";

export type BuiltinWidgetDef = {
  id: BuiltinHomeWidget;
  /** Viewing permission (module, action "view"). */
  module: CrmModule;
  defaultSize: WidgetSize;
  /** `home` namespace key. */
  titleKey: `widgets.${BuiltinHomeWidget}`;
};

/** Registry of the built-in Home widgets, in default order. */
export const BUILTIN_WIDGET_REGISTRY: readonly BuiltinWidgetDef[] = [
  { id: "kpi_open_leads", module: "leads", defaultSize: "sm" },
  { id: "kpi_pipeline", module: "opportunities", defaultSize: "sm" },
  { id: "kpi_won_month", module: "opportunities", defaultSize: "sm" },
  { id: "kpi_tasks_today", module: "activities", defaultSize: "sm" },
  { id: "pipeline_chart", module: "opportunities", defaultSize: "lg" },
  { id: "my_tasks", module: "activities", defaultSize: "md" },
  { id: "recent_records", module: "home", defaultSize: "md" },
  { id: "quick_access", module: "home", defaultSize: "lg" },
].map((w) => ({ ...w, titleKey: `widgets.${w.id}` }) as BuiltinWidgetDef);

export const builtinWidgetDef = (id: string) => BUILTIN_WIDGET_REGISTRY.find((w) => w.id === id);

/** Grid cell classes: 1 column (sm), 2 columns (md), full width (lg). */
export const WIDGET_SPAN: Record<WidgetSize, string> = {
  sm: "col-span-1",
  md: "md:col-span-2",
  lg: "md:col-span-2 xl:col-span-4",
};

/** Layout used when nothing is saved: every built-in the viewer may see. */
export function defaultHomeLayout(can: (module: CrmModule) => boolean): HomeWidget[] {
  return BUILTIN_WIDGET_REGISTRY.filter((w) => can(w.module)).map((w, position) => ({
    id: w.id,
    kind: "builtin",
    ref: w.id,
    size: w.defaultSize,
    position,
  }));
}

/** Built-ins not yet on the layout (for the "add widget" picker). */
export function availableBuiltins(widgets: { kind: string; ref: string }[], can: (m: CrmModule) => boolean) {
  const used = new Set(widgets.filter((w) => w.kind === "builtin").map((w) => w.ref));
  return BUILTIN_WIDGET_REGISTRY.filter((w) => !used.has(w.id) && can(w.module));
}

/** Sort by position and rewrite positions as 0..n-1. */
export function normalizePositions<T extends { position: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.position - b.position).map((item, position) => ({ ...item, position }));
}

/** Moves the item at `index` by `delta` (positions rewritten); same array when out of range. */
export function moveWidget<T extends { position: number }>(items: T[], index: number, delta: -1 | 1): T[] {
  const sorted = normalizePositions(items);
  const to = index + delta;
  if (to < 0 || to >= sorted.length) return sorted;
  const next = [...sorted];
  [next[index], next[to]] = [next[to], next[index]];
  return next.map((item, position) => ({ ...item, position }));
}

export function newWidgetId(): string {
  return `w${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`.slice(0, 64);
}

export { BUILTIN_HOME_WIDGETS };

/**
 * Edit helpers over the FULL (unfiltered) draft: widgets the viewer cannot see
 * or that have unknown refs stay in the draft and are saved untouched.
 */
export function moveWidgetById<T extends { id: string; position: number }>(
  draft: T[],
  visibleIds: readonly string[],
  id: string,
  delta: -1 | 1,
): T[] {
  const sorted = normalizePositions(draft);
  const visible = sorted.filter((w) => visibleIds.includes(w.id));
  const i = visible.findIndex((w) => w.id === id);
  const other = visible[i + delta];
  if (i < 0 || !other) return sorted;
  return sorted.map((w) =>
    w.id === id ? { ...w, position: other.position } : w.id === other.id ? { ...w, position: visible[i].position } : w,
  );
}

export const patchWidgetById = <T extends { id: string }>(draft: T[], id: string, patch: Partial<T>): T[] =>
  draft.map((w) => (w.id === id ? { ...w, ...patch } : w));

export const removeWidgetById = <T extends { id: string; position: number }>(draft: T[], id: string): T[] =>
  normalizePositions(draft.filter((w) => w.id !== id));
