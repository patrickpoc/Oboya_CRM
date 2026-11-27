import { NextResponse } from "next/server";
import type { DashboardWidgetData } from "@/lib/crm/reports/api-contract";
import { ReportDefinitionError, runReport } from "@/lib/crm/reports/engine";
import { getDashboard, getReport } from "@/lib/crm/reports/repository";
import type { DashboardWidget } from "@/lib/crm/reports/definition";
import {
  IdSchema,
  TzSchema,
  canOnObject,
  definitionProblem,
  failure,
  notFound,
  reportsGuard,
  runOptions,
  viewerOf,
  type ReportsGuard,
} from "@/lib/crm/reports/route";
import type { IdParams } from "@/lib/crm/setup/api.server";

export const dynamic = "force-dynamic";

const CONCURRENCY = 3;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

/** One widget: a failure never carries the report name or the error text. */
async function widgetData(
  guard: ReportsGuard,
  widget: DashboardWidget,
  tz: string | undefined
): Promise<DashboardWidgetData> {
  try {
    const report = await getReport(guard.supabase, viewerOf(guard), widget.reportId);
    if (!report) return { ok: false, error: "not_found" };
    if (!canOnObject(guard, report.definition.object, "view")) return { ok: false, error: "forbidden" };
    const chart = widget.chartOverride ?? report.definition.chart;
    const definition = { ...report.definition, chart };
    if (definitionProblem(definition)) return { ok: false, error: "invalid" };
    const result = await runReport(guard.supabase, definition, await runOptions(guard, tz));
    return { ok: true, report: { id: report.id, name: report.name }, chart, result };
  } catch (error) {
    if (error instanceof ReportDefinitionError) return { ok: false, error: "invalid" };
    console.error("[reports] dashboard widget failed:", (error as { code?: string })?.code ?? "unknown");
    return { ok: false, error: "failed" };
  }
}

/** GET: runs the dashboard's widgets, at most 3 at a time, each with the viewer's visibility. */
export async function GET(request: Request, { params }: IdParams) {
  const guard = await reportsGuard("view");
  if (guard instanceof NextResponse) return guard;
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) return notFound();
  const tz = TzSchema.safeParse(new URL(request.url).searchParams.get("tz") ?? undefined);
  try {
    const dashboard = await getDashboard(guard.supabase, viewerOf(guard), id);
    if (!dashboard) return notFound();
    const entries = await mapLimit(dashboard.widgets, CONCURRENCY, async (w) => [
      w.id,
      await widgetData(guard, w, tz.success ? tz.data : undefined),
    ] as const);
    return NextResponse.json({ widgets: Object.fromEntries(entries) });
  } catch (error) {
    return failure(error, "Dashboard data");
  }
}
