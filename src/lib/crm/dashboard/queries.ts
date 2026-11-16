import "server-only";

import type { CrmSupabaseClient } from "@/lib/supabase/server";
import type { CrmAction, CrmModule } from "@/lib/crm/types";
import { parseSlaHours } from "@/lib/crm/leads/sla";
import { activityConfig } from "@/lib/crm/objects/activity";
import { OBJECT_META, isCrmObject, type CrmObject } from "@/lib/crm/objects/types";
import { getEntities } from "@/lib/crm/repositories/lookups";
import { list } from "@/lib/crm/repositories/object-repository";
import {
  convertTotals,
  parseFxTable,
  stageSeries,
  sumByCurrency,
  type AmountRow,
  type FxTable,
  type StageRow,
} from "./aggregate";
import { dayBounds, monthBounds } from "./time";
import type { DashboardData, MoneyKpi, RecentRecord } from "./types";

/**
 * Home dashboard queries. Always the user-scoped client: RLS decides which
 * rows count. Counts use `head: true`; amounts are read as (stage, amount,
 * currency) tuples and summed here, never shipped to the browser row by row.
 */

const CHUNK = 1000;
const RECENT_LIMIT = 8;

type Can = (module: CrmModule, action?: CrmAction) => boolean;
export type DashboardInput = { userId: string; entityId: string | null; timeZone: string; now: Date; can: Can };

function check<T>(result: { data: T; error: { message: string } | null }, context: string): T {
  if (result.error) throw new Error(`dashboard ${context}: ${result.error.message}`);
  return result.data;
}

function countOf(result: { count: number | null; error: { message: string } | null }, context: string): number {
  if (result.error) throw new Error(`dashboard ${context}: ${result.error.message}`);
  return result.count ?? 0;
}

async function readSettings(client: CrmSupabaseClient) {
  const rows = check(
    await client.from("crm_settings").select("key, value").in("key", ["fx_rates", "lead_sla_hours"]),
    "settings"
  ) as Array<{ key: string; value: unknown }>;
  const value = (key: string) => rows.find((r) => r.key === key)?.value;
  return { fx: parseFxTable(value("fx_rates")), sla: parseSlaHours(value("lead_sla_hours")) };
}

/** Opportunity (stage, amount, currency) tuples for the given stages, paged past max-rows. */
async function opportunityAmounts(
  client: CrmSupabaseClient,
  stageIds: string[],
  entityId: string | null,
  closedRange?: { start: Date; end: Date }
): Promise<StageRow[]> {
  if (stageIds.length === 0) return [];
  const rows: StageRow[] = [];
  for (let from = 0; ; from += CHUNK) {
    let query = client
      .from("crm_opportunities")
      .select("stage_id, amount, currency")
      .in("stage_id", stageIds)
      .is("deleted_at", null);
    if (entityId) query = query.eq("entity_id", entityId);
    if (closedRange) {
      query = query.gte("closed_at", closedRange.start.toISOString()).lt("closed_at", closedRange.end.toISOString());
    }
    const chunk = check(await query.order("id").range(from, from + CHUNK - 1), "opportunities") as StageRow[];
    rows.push(...chunk);
    if (chunk.length < CHUNK) break;
  }
  return rows;
}

function moneyKpi(rows: AmountRow[], fx: FxTable | null): MoneyKpi {
  const totals = sumByCurrency(rows);
  const { total, base, missing } = convertTotals(totals, fx);
  return { count: rows.length, totals, converted: total, base, missing };
}

async function leadKpis(client: CrmSupabaseClient, input: DashboardInput, slaOverdueHours: number) {
  const base = () => {
    let q = client.from("crm_leads").select("id", { count: "exact", head: true }).is("deleted_at", null);
    if (input.entityId) q = q.eq("entity_id", input.entityId);
    return q;
  };
  const cutoff = new Date(input.now.getTime() - slaOverdueHours * 36e5).toISOString();
  const [open, overdue] = await Promise.all([
    base().in("status", ["new", "working"]),
    // Same rule as leads/sla.ts: new, never responded, older than the overdue threshold.
    base().eq("status", "new").is("first_responded_at", null).lte("created_at", cutoff),
  ]);
  return { open: countOf(open, "open leads"), slaOverdue: countOf(overdue, "sla leads") };
}

async function opportunityKpis(client: CrmSupabaseClient, input: DashboardInput, fx: FxTable | null) {
  const stages = check(
    await client
      .from("crm_pipeline_stages")
      .select("id, label, kind, active, sort_order, crm_pipelines!inner(is_default)")
      .order("sort_order"),
    "stages"
  ) as unknown as Array<{
    id: string;
    label: string;
    kind: string;
    active: boolean;
    crm_pipelines: { is_default: boolean } | null;
  }>;
  const openIds = stages.filter((s) => s.kind === "open").map((s) => s.id);
  const wonIds = stages.filter((s) => s.kind === "won").map((s) => s.id);
  const [open, won] = await Promise.all([
    opportunityAmounts(client, openIds, input.entityId),
    opportunityAmounts(client, wonIds, input.entityId, monthBounds(input.now, input.timeZone)),
  ]);
  const chartStages = stages.filter((s) => s.kind === "open" && s.active && s.crm_pipelines?.is_default);
  return {
    pipeline: moneyKpi(open, fx),
    won: moneyKpi(won, fx),
    stages: stageSeries(chartStages, open, fx),
  };
}

async function taskKpis(client: CrmSupabaseClient, input: DashboardInput) {
  const { start, end } = dayBounds(input.now, input.timeZone);
  const base = () =>
    client
      .from("crm_activities")
      .select("id", { count: "exact", head: true })
      .eq("type", "task")
      .eq("status", "open")
      .eq("owner_id", input.userId)
      .is("deleted_at", null);
  const [today, overdue] = await Promise.all([
    base().gte("due_at", start.toISOString()).lt("due_at", end.toISOString()),
    base().lt("due_at", start.toISOString()),
  ]);
  return { today: countOf(today, "tasks today"), overdue: countOf(overdue, "tasks overdue") };
}

async function myTasks(client: CrmSupabaseClient, input: DashboardInput) {
  const result = await list(
    client,
    activityConfig,
    {
      view: "mine",
      q: "",
      filters: { type: ["task"], status: ["open"] },
      sort: "due_at",
      dir: "asc",
      page: 0,
      pageSize: 5,
    },
    { userId: input.userId }
  );
  return result.rows;
}

/** The user's last viewed records still visible to them (RLS + module permission). */
async function recentRecords(client: CrmSupabaseClient, input: DashboardInput): Promise<RecentRecord[]> {
  const views = check(
    await client
      .from("crm_recent_views")
      .select("object, record_id, viewed_at")
      .order("viewed_at", { ascending: false })
      .limit(RECENT_LIMIT * 3),
    "recent views"
  ) as Array<{ object: string; record_id: string; viewed_at: string }>;

  const idsByObject = new Map<CrmObject, string[]>();
  for (const view of views) {
    if (!isCrmObject(view.object) || !input.can(OBJECT_META[view.object].module)) continue;
    idsByObject.set(view.object, [...(idsByObject.get(view.object) ?? []), view.record_id]);
  }
  const names = new Map<string, string>();
  await Promise.all(
    [...idsByObject].map(async ([object, ids]) => {
      const meta = OBJECT_META[object];
      const rows = check(
        await client.from(meta.table).select(`id, ${meta.nameColumn}`).in("id", ids).is("deleted_at", null),
        `recent ${object}`
      ) as unknown as Array<Record<string, string | null>>;
      for (const row of rows) names.set(`${object}:${row.id}`, row[meta.nameColumn] ?? "");
    })
  );
  return views
    .filter((v) => names.has(`${v.object}:${v.record_id}`))
    .slice(0, RECENT_LIMIT)
    .map((v) => ({
      object: v.object as CrmObject,
      id: v.record_id,
      name: names.get(`${v.object}:${v.record_id}`) || "—",
      viewedAt: v.viewed_at,
    }));
}

export async function loadDashboard(client: CrmSupabaseClient, input: DashboardInput): Promise<DashboardData> {
  const canLeads = input.can("leads");
  const canOpps = input.can("opportunities");
  const canTasks = input.can("activities");
  const settings = await readSettings(client);

  const [leads, opps, tasks, tasksList, recent, entities] = await Promise.all([
    canLeads ? leadKpis(client, input, settings.sla.overdue) : null,
    canOpps ? opportunityKpis(client, input, settings.fx) : null,
    canTasks ? taskKpis(client, input) : null,
    canTasks ? myTasks(client, input) : null,
    recentRecords(client, input),
    getEntities(client),
  ]);

  return {
    leads,
    pipeline: opps?.pipeline ?? null,
    won: opps?.won ?? null,
    tasks,
    stages: opps?.stages ?? null,
    myTasks: tasksList,
    recent,
    entities,
  };
}
