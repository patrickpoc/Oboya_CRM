// Reports, dashboards and home layouts: sharing, publish rule, filing rule,
// read_only, and per-viewer results of one shared report. Real user JWTs.
// Teams (seed): Ricardo manages Lucas + Camila (Brazil); Sanne manages Pieter; Wei is read_only.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { testEnv } from "../support/env";
import { runReport } from "@/lib/crm/reports/engine";
import { ReportDefinitionSchema, type GroupedReportResult } from "@/lib/crm/reports/definition";
import type { CrmSupabaseClient } from "@/lib/supabase/server";
import { as, ctx, type Actor } from "./context";

const created: Record<string, string[]> = {
  crm_reports: [],
  crm_dashboards: [],
  crm_report_folders: [],
  crm_home_layouts: [],
};
let brazilTeam = "";
/** Temporary team managed by Ricardo (home-layout tests never touch the real Brazil layout). */
let tempTeam = "";
let service: SupabaseClient;

const tag = () => `rls-test:${ctx().run}`;

async function make(actor: Actor, table: string, row: Record<string, unknown>) {
  const res = await as(actor).from(table).insert(row).select("id").single();
  if (res.data) created[table].push(res.data.id);
  return res;
}
const folder = (actor: Actor, visibility: string, teamId: string | null = null) =>
  make(actor, "crm_report_folders", { name: `${tag()} ${visibility}`, visibility, team_id: teamId });
const report = (actor: Actor, folderId: string | null = null) =>
  make(actor, "crm_reports", {
    name: `${tag()} report`,
    object: "lead",
    definition: { version: 1, object: "lead", type: "tabular", columns: ["company"] },
    folder_id: folderId,
  });
const dashboard = (actor: Actor, visibility: string, teamId: string | null = null) =>
  make(actor, "crm_dashboards", { name: `${tag()} dash`, visibility, team_id: teamId, widgets: [] });

async function seen(actor: Actor, table: string, ids: string[]) {
  const { data, error } = await as(actor).from(table).select("id").in("id", ids).is("deleted_at", null);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: { id: string }) => r.id).sort();
}
/** A write that RLS refuses fails with an error or touches no row. */
async function refused(p: PromiseLike<{ data: unknown; error: unknown }>) {
  const { data, error } = await p;
  return !!error || (Array.isArray(data) ? data.length === 0 : !data);
}

beforeAll(async () => {
  const env = testEnv();
  service = createClient(env.url, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await service.from("crm_users").select("team_id").eq("id", ctx().users.lucas).single();
  if (error || !data?.team_id) throw new Error("lucas has no team");
  brazilTeam = data.team_id;
  const t = await service
    .from("crm_teams")
    .insert({ name: `${tag()} team`, manager_id: ctx().users.ricardo })
    .select("id")
    .single();
  if (t.error) throw new Error(t.error.message);
  tempTeam = t.data.id;
});

afterAll(async () => {
  // Children first; audit rows of the removed records go too.
  for (const table of ["crm_reports", "crm_dashboards", "crm_home_layouts", "crm_report_folders"]) {
    const ids = created[table];
    if (!ids.length) continue;
    await service.from(table).delete().in("id", ids);
    await service.from("crm_audit_logs").delete().in("record_id", ids);
  }
  if (tempTeam) {
    await service.from("crm_teams").delete().eq("id", tempTeam);
    await service.from("crm_audit_logs").delete().eq("record_id", tempTeam);
  }
});

describe("report folders", () => {
  it("a private folder of Lucas is invisible to everyone else", async () => {
    const { data } = await folder("lucas", "private");
    const id = data!.id;
    expect(await seen("lucas", "crm_report_folders", [id])).toEqual([id]);
    for (const actor of ["camila", "ricardo", "pieter", "sanne", "wei"] as const) {
      expect(await seen(actor, "crm_report_folders", [id])).toEqual([]);
    }
  });

  it("a team folder of Ricardo's team reads for Lucas, Camila and Ricardo, not Pieter", async () => {
    const { data, error } = await folder("ricardo", "team", brazilTeam);
    expect(error).toBeNull();
    const id = data!.id;
    for (const actor of ["lucas", "camila", "ricardo", "admin"] as const) {
      expect(await seen(actor, "crm_report_folders", [id])).toEqual([id]);
    }
    for (const actor of ["pieter", "sanne"] as const) {
      expect(await seen(actor, "crm_report_folders", [id])).toEqual([]);
    }
  });

  it("a rep cannot publish to the team or to everyone", async () => {
    expect((await folder("lucas", "team", brazilTeam)).error).not.toBeNull();
    expect((await folder("lucas", "public")).error).not.toBeNull();
    expect((await dashboard("lucas", "team", brazilTeam)).error).not.toBeNull();
    expect((await dashboard("lucas", "public")).error).not.toBeNull();
  });

  it("a manager cannot publish to a team they do not manage", async () => {
    const { data } = await service.from("crm_users").select("team_id").eq("id", ctx().users.pieter).single();
    expect((await folder("ricardo", "team", data!.team_id)).error).not.toBeNull();
  });

  it("a rep cannot edit or take over another user's folder", async () => {
    const { data } = await folder("ricardo", "team", brazilTeam);
    const id = data!.id;
    expect(await refused(as("lucas").from("crm_report_folders").update({ name: "hax" }).eq("id", id).select("id"))).toBe(true);
    expect(await refused(as("lucas").from("crm_report_folders").update({ deleted_at: new Date().toISOString() }).eq("id", id).select("id"))).toBe(true);
  });

  it("owner soft-deletes their folder; it leaves the lists", async () => {
    const { data } = await folder("lucas", "private");
    const id = data!.id;
    const del = await as("lucas").from("crm_report_folders").update({ deleted_at: new Date().toISOString() }).eq("id", id).select("id");
    expect(del.error).toBeNull();
    expect(await seen("lucas", "crm_report_folders", [id])).toEqual([]);
  });
});

describe("reports", () => {
  it("a rep cannot file a report into another person's folder", async () => {
    const { data } = await folder("ricardo", "team", brazilTeam);
    expect((await report("lucas", data!.id)).error).not.toBeNull();
  });

  it("a report inherits its folder's visibility", async () => {
    const f = (await folder("ricardo", "team", brazilTeam)).data!.id;
    const shared = (await report("ricardo", f)).data!.id;
    const own = (await report("ricardo")).data!.id; // no folder: private
    expect(await seen("lucas", "crm_reports", [shared, own])).toEqual([shared]);
    expect(await seen("pieter", "crm_reports", [shared, own])).toEqual([]);
    expect(await seen("ricardo", "crm_reports", [shared, own])).toEqual([shared, own].sort());
  });

  it("a rep keeps a private report and cannot move it into someone else's folder", async () => {
    const f = (await folder("ricardo", "team", brazilTeam)).data!.id;
    const mine = (await report("lucas")).data!.id;
    expect(await seen("camila", "crm_reports", [mine])).toEqual([]);
    expect(await refused(as("lucas").from("crm_reports").update({ folder_id: f }).eq("id", mine).select("id"))).toBe(true);
  });

  it("only the owner or an admin edits a shared report", async () => {
    const f = (await folder("ricardo", "team", brazilTeam)).data!.id;
    const id = (await report("ricardo", f)).data!.id;
    expect(await refused(as("lucas").from("crm_reports").update({ name: "hax" }).eq("id", id).select("id"))).toBe(true);
    expect(await refused(as("admin").from("crm_reports").update({ name: `${tag()} admin` }).eq("id", id).select("id"))).toBe(false);
  });
});

describe("dashboards", () => {
  it("a public dashboard is readable by everyone and writable only by its owner or an admin", async () => {
    const { data, error } = await dashboard("ricardo", "public");
    expect(error).toBeNull();
    const id = data!.id;
    for (const actor of ["lucas", "camila", "pieter", "sanne", "wei"] as const) {
      expect(await seen(actor, "crm_dashboards", [id])).toEqual([id]);
    }
    for (const actor of ["lucas", "pieter", "sanne", "wei"] as const) {
      expect(await refused(as(actor).from("crm_dashboards").update({ name: "hax" }).eq("id", id).select("id"))).toBe(true);
    }
    expect(await refused(as("ricardo").from("crm_dashboards").update({ name: `${tag()} own` }).eq("id", id).select("id"))).toBe(false);
    expect(await refused(as("admin").from("crm_dashboards").update({ name: `${tag()} adm` }).eq("id", id).select("id"))).toBe(false);
  });

  it("a team dashboard is limited to the team", async () => {
    const id = (await dashboard("ricardo", "team", brazilTeam)).data!.id;
    expect(await seen("lucas", "crm_dashboards", [id])).toEqual([id]);
    expect(await seen("pieter", "crm_dashboards", [id])).toEqual([]);
  });

  it("a dashboard holds at most 20 widgets", async () => {
    const widgets = Array.from({ length: 21 }, (_, i) => ({ id: `w${i}` }));
    const res = await as("lucas").from("crm_dashboards").insert({ name: `${tag()} big`, visibility: "private", widgets }).select("id");
    expect(res.error).not.toBeNull();
  });
});

describe("read_only", () => {
  it("cannot create folders, reports or dashboards", async () => {
    expect((await folder("wei", "private")).error).not.toBeNull();
    expect((await report("wei")).error).not.toBeNull();
    expect((await dashboard("wei", "private")).error).not.toBeNull();
  });

  it("cannot edit a shared report it can read", async () => {
    const f = (await folder("ricardo", "public")).data!.id;
    const id = (await report("ricardo", f)).data!.id;
    expect(await seen("wei", "crm_reports", [id])).toEqual([id]);
    expect(await refused(as("wei").from("crm_reports").update({ name: "hax" }).eq("id", id).select("id"))).toBe(true);
  });
});

describe("home layouts", () => {
  it("a user writes only their own layout", async () => {
    const mine = await make("admin", "crm_home_layouts", { scope: "user", user_id: ctx().users.admin, widgets: [] });
    expect(mine.error).toBeNull();
    const other = await as("lucas").from("crm_home_layouts").insert({ scope: "user", user_id: ctx().users.ricardo, widgets: [] });
    expect(other.error).not.toBeNull();
  });

  it("team layouts: the team's manager writes, others neither read nor write", async () => {
    expect((await as("lucas").from("crm_home_layouts").insert({ scope: "team", team_id: tempTeam, widgets: [] })).error).not.toBeNull();
    expect((await as("sanne").from("crm_home_layouts").insert({ scope: "team", team_id: tempTeam, widgets: [] })).error).not.toBeNull();
    const { data, error } = await make("ricardo", "crm_home_layouts", { scope: "team", team_id: tempTeam, widgets: [] });
    expect(error).toBeNull();
    const id = data!.id;
    expect(await seen("ricardo", "crm_home_layouts", [id])).toEqual([id]);
    expect(await seen("lucas", "crm_home_layouts", [id])).toEqual([]);
    expect(await seen("pieter", "crm_home_layouts", [id])).toEqual([]);
    expect(await refused(as("lucas").from("crm_home_layouts").update({ widgets: [{ id: "x" }] }).eq("id", id).select("id"))).toBe(true);
    expect(await refused(as("lucas").from("crm_home_layouts").delete().eq("id", id).select("id"))).toBe(true);
  });

  it("a layout cannot be created owned by someone else", async () => {
    const res = await as("lucas")
      .from("crm_home_layouts")
      .insert({ scope: "user", user_id: ctx().users.lucas, owner_id: ctx().users.ricardo, widgets: [] });
    expect(res.error).not.toBeNull();
  });

  it("only an admin writes the default layout", async () => {
    for (const actor of ["lucas", "ricardo", "wei"] as const) {
      expect((await as(actor).from("crm_home_layouts").insert({ scope: "default", widgets: [] })).error).not.toBeNull();
    }
  });
});

describe("one shared report, different results per viewer", () => {
  const def = ReportDefinitionSchema.parse({
    version: 1,
    object: "opportunity",
    type: "summary",
    rowGroups: [{ field: "owner_id" }],
    aggregates: [{ fn: "count" }],
  });
  const run = async (actor: Actor) =>
    (await runReport(as(actor) as unknown as CrmSupabaseClient, def, {
      userId: ctx().users[actor],
      timeZone: "UTC",
      locale: "en",
    })) as GroupedReportResult;

  it("counts only what each viewer can see", async () => {
    const { users } = ctx();
    const [lucas, ricardo, pieter] = await Promise.all([run("lucas"), run("ricardo"), run("pieter")]);
    const owners = (r: GroupedReportResult) => r.groups.map((g) => g.key);
    expect(owners(lucas)).toContain(users.lucas);
    expect(owners(lucas)).not.toContain(users.camila);
    expect(owners(lucas)).not.toContain(users.pieter);
    expect(owners(ricardo)).toEqual(expect.arrayContaining([users.lucas, users.camila, users.ricardo]));
    expect(owners(ricardo)).not.toContain(users.pieter);
    expect(owners(pieter)).toContain(users.pieter);
    expect(owners(pieter)).not.toContain(users.lucas);
    expect(ricardo.totals[0]).toBeGreaterThan(lucas.totals[0]);
    expect(new Set([lucas.totals[0], ricardo.totals[0], pieter.totals[0]]).size).toBeGreaterThan(1);
  });
});

describe("hardening", () => {
  it("a report's object column must match its definition", async () => {
    const res = await make("lucas", "crm_reports", {
      name: `${tag()} mismatch`,
      object: "account",
      definition: { version: 1, object: "lead", type: "tabular", columns: ["company"] },
    });
    expect(res.error).not.toBeNull();
  });

  it("widgets are capped at 16 KB", async () => {
    const widgets = Array.from({ length: 18 }, (_, i) => ({ id: `w${i}`, pad: "x".repeat(1000) }));
    const res = await as("lucas").from("crm_dashboards").insert({ name: `${tag()} fat`, visibility: "private", widgets }).select("id");
    expect(res.error).not.toBeNull();
  });

  it("a soft delete cannot also publish, re-team or re-file", async () => {
    const now = new Date().toISOString();
    const d = (await dashboard("lucas", "private")).data!.id;
    expect(await refused(as("lucas").from("crm_dashboards").update({ deleted_at: now, visibility: "public" }).eq("id", d).select("id"))).toBe(true);
    const f = (await folder("lucas", "private")).data!.id;
    expect(await refused(as("lucas").from("crm_report_folders").update({ deleted_at: now, visibility: "team", team_id: brazilTeam }).eq("id", f).select("id"))).toBe(true);
    const shared = (await folder("ricardo", "team", brazilTeam)).data!.id;
    const r = (await report("lucas")).data!.id;
    expect(await refused(as("lucas").from("crm_reports").update({ deleted_at: now, folder_id: shared }).eq("id", r).select("id"))).toBe(true);
  });

  it("crm_manages_team(null) is false; crm_manages_any_team() is true for managers only", async () => {
    expect((await as("ricardo").rpc("crm_manages_team", { p_team: null })).data).toBe(false);
    expect((await as("ricardo").rpc("crm_manages_any_team")).data).toBe(true);
    expect((await as("lucas").rpc("crm_manages_any_team")).data).toBe(false);
  });
});
