/* eslint-disable @typescript-eslint/no-explicit-any -- untyped SQL result rows */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

// Real PostgreSQL in memory. Every migration runs once, then the automation
// migrations run a second time (idempotency; older migrations are not re-runnable).
// pg_cron does not exist here, so the cron migration must be a no-op.
const db = new PGlite({ extensions: { pgcrypto, pg_trgm } });
const id = (n: number) => `00000000-0000-4000-8000-0000000000${n}`;
const U = { admin: id(11), mgr: id(12), a: id(13), b: id(14), c: id(15), ro: id(16) };
type Who = keyof typeof U;
type Row = Record<string, any>;
type Res = { rows?: Row[]; err?: string; code?: string };

const s = async (sql: string, p?: unknown[]) => (await db.query<Record<string, any>>(sql, p)).rows;
async function q(who: Who, sql: string, p?: unknown[]): Promise<Res> {
  await db.exec(`set role authenticated; select set_config('request.jwt.claims', '${JSON.stringify({ sub: U[who], role: "authenticated" })}', false)`);
  try {
    return { rows: (await db.query<Record<string, any>>(sql, p)).rows };
  } catch (e) {
    return { err: (e as Error).message, code: (e as { code?: string }).code };
  } finally {
    await db.exec("reset role; select set_config('request.jwt.claims','',false)");
  }
}
const okRows = (r: Res) => {
  expect(r.err).toBeUndefined();
  return r.rows!;
};
const fails = (r: Res) => expect(r.err !== undefined || r.rows!.length === 0).toBe(true);
const pick = async (c: string | null, e: string | null, src: string | null) =>
  (await s("select * from crm_assign_lead_owner($1,$2,$3)", [c, e, src]))[0];
const lastAudit = async (object: string, recordId: string, extra = "") =>
  (await s(`select actor_id, actor_name, context, action from crm_audit_logs where object=$1 and record_id=$2 ${extra} order by id desc limit 1`, [object, recordId]))[0];

let pipe = "", s1 = "", s2 = "", acc = "";

beforeAll(async () => {
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create schema extensions;
    create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}', email_confirmed_at timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub','')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select auth.jwt() ->> 'role' $$;
    grant usage on schema public, auth, extensions to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    alter database template1 set search_path = public, extensions;
    set search_path = public, extensions;
  `);
  const dir = path.resolve("supabase/migrations");
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) await db.exec(readFileSync(path.join(dir, f), "utf8"));
  for (const f of files.filter((f) => f >= "20261128")) await db.exec(readFileSync(path.join(dir, f), "utf8"));

  for (const [k, v] of Object.entries(U)) await db.exec(`insert into auth.users (id,email) values ('${v}','${k}@x.com')`);
  const roles: Record<Who, string> = { admin: "super_admin", mgr: "sales_manager", a: "sales_rep", b: "sales_rep", c: "sales_rep", ro: "read_only" };
  for (const [k, r] of Object.entries(roles)) await db.exec(`update crm_users set role='${r}', status='active' where id='${U[k as Who]}'`);
  await db.exec(`insert into crm_teams (id,name,manager_id) values ('${id(21)}','A','${U.mgr}'); update crm_users set team_id='${id(21)}' where id in ('${U.a}','${U.b}')`);
  pipe = (await s("select id from crm_pipelines where is_default"))[0].id;
  [s1, s2] = (await s("select id from crm_pipeline_stages where pipeline_id=$1 and kind='open' order by sort_order", [pipe])).map((x) => x.id);
  acc = (await s(`insert into crm_accounts (name,owner_id) values ('Acme','${U.a}') returning id`))[0].id;
}, 120_000);
afterAll(async () => { await db.close(); });

describe("migration", () => {
  it("grants the automation module and seeds the alert rules", async () => {
    const mx = (await s("select matrix from crm_access_control"))[0].matrix;
    expect([mx.super_admin.automation, mx.sales_manager.automation, mx.sales_rep.automation, mx.read_only.automation]).toEqual(["full", ["view"], "none", "none"]);
    expect((await s("select count(*)::int n from crm_alert_rules"))[0].n).toBe(3);
    expect((await s("select count(*)::int n from pg_extension where extname = 'pg_cron'"))[0].n).toBe(0);
  });
});

describe("assignment", () => {
  it("rules in order, cursor wraps, inactive members skipped, fallback used", async () => {
    await db.exec(`insert into crm_assignment_rules (name,country_codes,target_type,pool_user_ids,sort_order) values ('BR rr',array['BR'],'round_robin',array['${U.a}','${U.b}','${U.c}']::uuid[],10)`);
    await db.exec(`insert into crm_assignment_rules (name,sources,target_type,target_user_id,sort_order,stop_processing) values ('web user',array['web'],'user','${U.c}',20,true)`);
    expect((await pick("br", null, null)).owner_id).toBe(U.a);
    expect((await pick("BR", null, null)).owner_id).toBe(U.b);
    await db.exec(`update crm_users set status='disabled' where id='${U.c}'`);
    expect((await pick("BR", null, null)).owner_id).toBe(U.a); // c skipped, wrap
    expect((await pick("BR", null, null)).owner_id).toBe(U.b);
    expect((await pick("BR", null, null)).owner_id).toBe(U.a);
    await db.exec(`update crm_users set status='active' where id='${U.c}'`);

    const before = (await s("select last_user_id from crm_assignment_cursors"))[0].last_user_id;
    await s("select * from crm_assign_lead_owner('BR',null,null,false)");
    expect((await s("select last_user_id from crm_assignment_cursors"))[0].last_user_id).toBe(before);

    const web = await pick(null, null, "web");
    expect([web.owner_id, web.via]).toEqual([U.c, "rule"]);
    const none = await pick("US", null, "other");
    expect([none.via, none.rule_id]).toEqual(["super_admin", null]);
    await db.exec(`update crm_users set status='disabled' where id='${U.c}'`);
    expect((await pick(null, null, "web")).via).toBe("super_admin"); // stop_processing -> fallback
    await db.exec(`update crm_users set status='active' where id='${U.c}'`);
  });
});

let inbound = "";
describe("inbound insert and attribution", () => {
  it("assigns an owner and audits as Automation; the settings are reset afterwards", async () => {
    await db.exec(`update crm_assignment_rules set active=false where name='BR rr'`);
    const lead = (await s(`insert into crm_leads (last_name,email,source,country_code) values ('Inb','inb@x.com','web','BR') returning id,owner_id`))[0];
    inbound = lead.id;
    expect(lead.owner_id).toBe(U.c);
    const au = await lastAudit("lead", lead.id, "and action='create'");
    expect([au.actor_name, au.actor_id, au.context.kind, au.context.rule_name]).toEqual(["Automation", null, "assignment", "web user"]);
    expect((await s("select count(*)::int n from crm_notifications where user_id=$1 and kind='lead_assigned'", [U.c]))[0].n).toBe(1);
    expect((await s("select coalesce(current_setting('crm.inbound_ctx', true),'') v, coalesce(current_setting('crm.actor', true),'') a"))[0]).toEqual({ v: "", a: "" });
  });

  it("attributes every row of a multi-row insert", async () => {
    await db.exec(`insert into crm_leads (last_name,email,source) values ('B1','b1@x.com','web'),('B2','b2@x.com','web'),('B3','b3@x.com','web')`);
    expect((await s("select count(*)::int n from crm_audit_logs where object='lead' and action='create' and actor_name='Automation'"))[0].n).toBe(4);
    expect((await s("select coalesce(current_setting('crm.inbound_ctx', true),'') v"))[0].v).toBe("");
  });

  it("a failed insert leaves no residue", async () => {
    await expect(db.exec(`insert into crm_leads (last_name,email,source) values ('D','inb@x.com','web')`)).rejects.toThrow();
    expect((await s("select coalesce(current_setting('crm.inbound_ctx', true),'') v"))[0].v).toBe("");
  });

  it("apply writes as Automation, then a user write in the same transaction is attributed to the user", async () => {
    await db.exec(`update crm_leads set owner_id='${U.a}' where id='${inbound}'`);
    const r = okRows(await q("admin", "select crm_apply_assignment_rules($1) r", [inbound]));
    expect(r[0].r.owner_id).toBe(U.c);
    const au = await lastAudit("lead", inbound, "and action='owner_change'");
    expect([au.actor_name, au.actor_id, au.context.triggered_by, au.context.via]).toEqual(["Automation", null, U.admin, "rule"]);

    await db.exec(`update crm_leads set owner_id='${U.a}' where id='${inbound}'`);
    await db.exec(`set role authenticated; select set_config('request.jwt.claims', '${JSON.stringify({ sub: U.admin, role: "authenticated" })}', false)`);
    try {
      await db.exec("begin");
      await db.query("select crm_apply_assignment_rules($1)", [inbound]);
      await db.query("update crm_leads set title='CEO' where id=$1", [inbound]);
      await db.exec("commit");
    } finally {
      await db.exec("reset role; select set_config('request.jwt.claims','',false)");
    }
    const user = await lastAudit("lead", inbound);
    expect([user.actor_id, user.context]).toEqual([U.admin, null]);
    expect((await s("select updated_by from crm_leads where id=$1", [inbound]))[0].updated_by).toBe(U.admin);
  });

  it("apply does not advance the cursor when the owner is unchanged; invisible = missing", async () => {
    await db.exec(`update crm_assignment_rules set active=true where name='BR rr'`);
    await db.exec(`update crm_assignment_rules set active=false where name='web user'`);
    const lead = (await s(`insert into crm_leads (last_name,email,owner_id,country_code) values ('Cur','cur@x.com','${U.a}','BR') returning id`))[0].id;
    const cursor = async () => (await s("select last_user_id from crm_assignment_cursors c join crm_assignment_rules r on r.id=c.rule_id where r.name='BR rr'"))[0].last_user_id;
    // cursor is at b (next is c); owner a is not the next member -> owner changes
    await s("select * from crm_assign_lead_owner('BR',null,null)"); // move to ... keep deterministic below
    const before = await cursor();
    const next = (await s("select * from crm_assign_lead_owner('BR',null,null,false)"))[0].owner_id;
    await db.exec(`update crm_leads set owner_id='${next}' where id='${lead}'`);
    okRows(await q("admin", "select crm_apply_assignment_rules($1)", [lead]));
    expect(await cursor()).toBe(before);
    expect((await q("b", "select crm_apply_assignment_rules($1)", [lead])).code).toBe("P0002");
    expect((await q("ro", "select crm_apply_assignment_rules($1)", [lead])).code).toBe("42501");
    await db.exec(`update crm_assignment_rules set active=false where name='BR rr'`);
    await db.exec(`update crm_assignment_rules set active=true where name='web user'`);
  });

  it("converted leads cannot be reassigned; previews are scoped", async () => {
    const cl = (await s(`insert into crm_leads (last_name,email,owner_id,status,converted_at) values ('Conv','conv@x.com','${U.a}','qualified',now()) returning id`))[0].id;
    expect((await q("admin", "select crm_apply_assignment_rules($1)", [cl])).err).toMatch(/lead_converted/);
    const own = okRows(await q("a", "select crm_assignment_preview_for_lead($1) r", [cl]));
    expect(Object.keys(own[0].r).sort()).toEqual(["owner_id", "via"]);
    expect((await q("b", "select crm_assignment_preview_for_lead($1)", [cl])).code).toBe("P0002");
    expect((await q("a", "select crm_assignment_preview('BR',null,null)")).code).toBe("42501");
    okRows(await q("mgr", "select crm_assignment_preview('BR',null,null)"));
  });

  it("clients cannot call the runner or internals", async () => {
    for (const f of ["crm_run_automation(now(),'manual',null)", "crm_assign_lead_owner('BR',null,null)", "crm_automation_begin('{}'::jsonb)", `crm_notify('${U.a}','lead_assigned','{}'::jsonb,null,null,null)`]) {
      expect((await q("admin", `select ${f}`)).err, f).toBeDefined();
    }
  });

  it("clients cannot forge automation activities", async () => {
    const lead = (await s(`insert into crm_leads (last_name,email,owner_id) values ('Forge','forge@x.com','${U.a}') returning id`))[0].id;
    const ins = (extra: string) => q("a", `insert into crm_activities (type,subject,what_object,what_id,owner_id,${extra}) values ('task','x','lead','${lead}','${U.a}',$1) returning id`, extra.startsWith("meta") ? ['{"automation":{"kind":"x"}}'] : ["automation:sla:x"]);
    expect((await ins("meta")).code).toBe("42501");
    expect((await ins("external_ref")).code).toBe("42501");
    const ok = okRows(await q("a", `insert into crm_activities (type,subject,what_object,what_id,owner_id) values ('task','x','lead','${lead}','${U.a}') returning id`));
    expect((await q("a", `update crm_activities set meta='{"automation":{"kind":"x"}}' where id=$1`, [ok[0].id])).code).toBe("42501");
  });
});

describe("stage tasks", () => {
  let opp = "";
  const tasks = (o: string) => s("select * from crm_activities where what_id=$1 and external_ref like 'automation:stage:%'", [o]);

  it("creates once via the stage RPC and never on replay", async () => {
    await db.exec(`insert into crm_stage_task_templates (stage_id,pipeline_id,subject,due_in_days) values ('${s2}','${pipe}','Qualify call',2)`);
    const o = (await s(`insert into crm_opportunities (name,account_id,pipeline_id,stage_id,owner_id) values ('Opp','${acc}','${pipe}','${s1}','${U.a}') returning id`))[0];
    opp = o.id;
    expect(await tasks(opp)).toHaveLength(0);
    okRows(await q("a", "select crm_change_opportunity_stage($1,$2)", [opp, s2]));
    const t = await tasks(opp);
    expect(t).toHaveLength(1);
    expect([t[0].owner_id, t[0].created_by, t[0].meta.automation.kind]).toEqual([U.a, null, "stage_task"]);
    const au = await lastAudit("activity", t[0].id);
    expect([au.actor_name, au.context.template_name]).toEqual(["Automation", "Qualify call"]);
    expect((await s("select count(*)::int n from crm_notifications where kind='task_assigned'"))[0].n).toBe(0); // mover is the assignee
    okRows(await q("a", "select crm_change_opportunity_stage($1,$2)", [opp, s2]));
    expect(await tasks(opp)).toHaveLength(1);
  });

  it("creates via the kanban path (direct update); re-entering makes a new task", async () => {
    okRows(await q("a", "update crm_opportunities set stage_id=$2 where id=$1 returning id", [opp, s1]));
    okRows(await q("a", "update crm_opportunities set stage_id=$2 where id=$1 returning id", [opp, s2]));
    expect(await tasks(opp)).toHaveLength(2);
    // the same-stage update does not add one
    okRows(await q("a", "update crm_opportunities set stage_id=$2, next_step='x' where id=$1 returning id", [opp, s2]));
    expect(await tasks(opp)).toHaveLength(2);
  });

  it("creates via convert, and notifies a different assignee", async () => {
    await db.exec(`insert into crm_stage_task_templates (stage_id,pipeline_id,subject,assignee_type) values ('${s1}','${pipe}','First stage task','owner_manager')`);
    const lead = (await s(`insert into crm_leads (last_name,email,owner_id) values ('Cv','cv@x.com','${U.a}') returning id`))[0].id;
    const cv = okRows(await q("a", "select crm_convert_lead($1) r", [lead]));
    const t = await tasks(cv[0].r.opportunity_id);
    expect(t).toHaveLength(1);
    expect(t[0].owner_id).toBe(U.mgr);
    expect((await s("select count(*)::int n from crm_notifications where kind='task_assigned' and user_id=$1", [U.mgr]))[0].n).toBe(1);
  });
});

describe("first response", () => {
  const lead = async (email: string) => (await s(`insert into crm_leads (last_name,email,owner_id) values ('FR','${email}','${U.a}') returning id`))[0].id;
  const stamp = async (l: string) => (await s("select first_responded_at f, created_at c from crm_leads where id=$1", [l]))[0];
  const act = (l: string, type: string, status = "done", meta = "") =>
    q("a", `insert into crm_activities (type,subject,status,what_object,what_id,owner_id${meta ? ",meta" : ""}) values ('${type}','x','${status}','lead','${l}','${U.a}'${meta ? `,'${meta}'` : ""})`);

  it("a done call or meeting counts; a note, an inbound email or an open call does not", async () => {
    const l = await lead("fr@x.com");
    okRows(await act(l, "note"));
    okRows(await act(l, "email", "done", '{"direction":"inbound"}'));
    okRows(await act(l, "call", "open"));
    expect((await stamp(l)).f).toBeNull();
    okRows(await act(l, "meeting"));
    const f = await stamp(l);
    expect(f.f).not.toBeNull();
    expect(new Date(f.f) >= new Date(f.c) && new Date(f.f) <= new Date()).toBe(true);
  });

  it("an outbound email counts, and marking a call done counts", async () => {
    const l2 = await lead("fr2@x.com");
    okRows(await act(l2, "email"));
    expect((await stamp(l2)).f).not.toBeNull();
    const l3 = await lead("fr3@x.com");
    const call = okRows(await q("a", `insert into crm_activities (type,subject,status,what_object,what_id,owner_id) values ('call','x','open','lead','${l3}','${U.a}') returning id`));
    okRows(await q("a", "update crm_activities set status='done' where id=$1 returning id", [call[0].id]));
    expect((await stamp(l3)).f).not.toBeNull();
  });
});

describe("runner", () => {
  let old = "", stale = "";
  const counts = async () => ({
    n: (await s("select count(*)::int n from crm_notifications"))[0].n,
    t: (await s("select count(*)::int n from crm_activities"))[0].n,
  });
  const run = async (at = "now()", trigger = "manual") => (await s(`select crm_run_automation(${at},'${trigger}',null) r`))[0].r;

  it("is idempotent: the second run has the same counts and creates nothing", async () => {
    await db.exec(`update crm_assignment_rules set active=false`);
    old = (await s(`insert into crm_leads (last_name,email,owner_id,created_at) values ('Old','old@x.com','${U.a}', now() - interval '3 days') returning id`))[0].id;
    stale = (await s(`insert into crm_opportunities (name,account_id,pipeline_id,stage_id,owner_id,created_at) values ('Stale','${acc}','${pipe}','${s1}','${U.a}', now() - interval '30 days') returning id`))[0].id;
    await db.exec(`insert into crm_activities (type,subject,status,due_at,what_object,what_id,owner_id,created_at) values ('task','Late','open', now() - interval '2 days','opportunity','${stale}','${U.a}', now() - interval '30 days')`);
    const r1 = await run();
    expect(r1.status).toBe("ok");
    expect(r1.counts.stalled).toBeGreaterThanOrEqual(1);
    expect(r1.counts.overdue).toBeGreaterThanOrEqual(1);
    expect(r1.counts.sla).toBeGreaterThanOrEqual(1);
    const c1 = await counts();
    const sla = (await s("select owner_id, priority, meta from crm_activities where external_ref=$1", ["automation:sla:" + old]))[0];
    expect([sla.owner_id, sla.priority, sla.meta.automation.subjectKey]).toEqual([U.mgr, "urgent", "automation.sla.taskSubject"]);
    expect((await s("select count(*)::int n from crm_notifications where dedupe_key=$1 and user_id=$2", ["sla:" + old, U.mgr]))[0].n).toBe(1);
    const sctx = await lastAudit("activity", (await s("select id from crm_activities where external_ref=$1", ["automation:sla:" + old]))[0].id);
    expect([sctx.actor_name, sctx.context.kind, sctx.context.rule_name]).toEqual(["Automation", "sla_escalation", undefined]);
    const r2 = await run("now()", "pg_cron");
    expect(r2.counts).toEqual(r1.counts);
    expect(await counts()).toEqual(c1);
  });

  it("re-arms a stalled alert only after new activity and another threshold period", async () => {
    const stalled = async () => (await s("select count(*)::int n from crm_notifications where kind='stalled_deal' and record_id=$1", [stale]))[0].n;
    expect(await stalled()).toBe(1);
    await db.exec(`insert into crm_activities (type,subject,status,what_object,what_id,owner_id) values ('call','touch','done','opportunity','${stale}','${U.a}')`);
    await run();
    expect(await stalled()).toBe(1);
    await run("now() + interval '15 days'");
    expect(await stalled()).toBe(2);
  });

  it("uses the most specific overdue rule and honours notify_manager for stalled deals", async () => {
    // a stage-level override that is inactive switches overdue alerts off for that stage
    await db.exec(`insert into crm_alert_rules (kind, stage_id, threshold, active) values ('overdue_task','${s1}',0,false)`);
    await db.exec(`insert into crm_activities (type,subject,status,due_at,what_object,what_id,owner_id) values ('task','Late2','open', now() - interval '2 days','opportunity','${stale}','${U.a}')`);
    await run("now() + interval '1 day'");
    expect((await s("select count(*)::int n from crm_notifications where kind='overdue_task' and params->>'subject'='Late2'"))[0].n).toBe(0);
    await db.exec(`update crm_alert_rules set active=true where kind='overdue_task' and stage_id is not null`);
    await run("now() + interval '1 day'");
    expect((await s("select count(*)::int n from crm_notifications where kind='overdue_task' and params->>'subject'='Late2'"))[0].n).toBe(1);
    await db.exec(`update crm_alert_rules set notify_manager=true where kind='stalled_deal'`);
    await run("now() + interval '40 days'");
    expect((await s("select count(*)::int n from crm_notifications where kind='stalled_deal' and user_id=$1 and record_id=$2", [U.mgr, stale]))[0].n).toBeGreaterThanOrEqual(1);
  });

  it("stores only the SQLSTATE of a failing section", async () => {
    await db.exec("alter table crm_notifications rename to crm_notifications_x");
    try {
      const r = await run();
      expect(r.status).not.toBe("ok");
      for (const e of r.errors) expect(e.message).toMatch(/^SQLSTATE [0-9A-Z]{5}$/);
    } finally {
      await db.exec("alter table crm_notifications_x rename to crm_notifications");
    }
  });
});

describe("RLS", () => {
  it("config tables: manager views, cannot write; reps cannot read; create/delete are separate permissions", async () => {
    expect((okRows(await q("mgr", "select id from crm_assignment_rules"))).length).toBeGreaterThan(0);
    fails(await q("mgr", "insert into crm_assignment_rules (name,target_type,target_user_id) values ('m','user',$1) returning id", [U.a]));
    fails(await q("a", "select id from crm_assignment_rules"));
    fails(await q("ro", "select id from crm_alert_rules"));
    const made = okRows(await q("admin", "insert into crm_assignment_rules (name,target_type,target_user_id) values ('adm','user',$1) returning id", [U.a]));
    // edit without delete may update but not delete
    await db.exec(`update crm_users set permission_overrides='{"grants":{"automation":["view","edit"]}}' where id='${U.mgr}'`);
    okRows(await q("mgr", "update crm_assignment_rules set name='adm2' where id=$1 returning id", [made[0].id]));
    fails(await q("mgr", "delete from crm_assignment_rules where id=$1 returning id", [made[0].id]));
    fails(await q("mgr", "insert into crm_assignment_rules (name,target_type,target_user_id) values ('m','user',$1) returning id", [U.a]));
    await db.exec(`update crm_users set permission_overrides='{}' where id='${U.mgr}'`);
    fails(await q("admin", "select * from crm_assignment_cursors"));
  });

  it("notifications are private; clients cannot insert; read_at is forced to now()", async () => {
    const mine = await q("mgr", "select id, user_id from crm_notifications");
    expect(okRows(mine).length).toBeGreaterThan(0);
    expect(okRows(mine).every((r) => r.user_id === U.mgr)).toBe(true);
    fails(await q("mgr", "insert into crm_notifications (user_id,kind) values ($1,'lead_assigned') returning id", [U.mgr]));
    fails(await q("a", "update crm_notifications set read_at=now() where user_id=$1 returning id", [U.mgr]));
    const upd = okRows(await q("mgr", "update crm_notifications set read_at='2000-01-01' where user_id=$1 returning read_at", [U.mgr]));
    expect(new Date(upd[0].read_at).getFullYear()).toBeGreaterThan(2020);
    expect((await q("mgr", "update crm_notifications set kind='lead_assigned' where user_id=$1 returning id", [U.mgr])).err).toBeDefined();
  });

  it("reordering needs automation.edit and the full id set", async () => {
    const ids = (await s("select id from crm_assignment_rules order by sort_order,id")).map((x) => x.id);
    okRows(await q("admin", "select crm_reorder_assignment_rules($1::uuid[])", [ids.slice().reverse()]));
    expect((await q("admin", "select crm_reorder_assignment_rules($1::uuid[])", [ids.slice(1)])).code).toBe("22023");
    expect((await q("mgr", "select crm_reorder_assignment_rules($1::uuid[])", [ids])).err).toBeDefined();
  });
});
