// Automation: config tables, notifications, RPC grants and Automation attribution.
// Real user JWTs. Teams (seed): Ricardo (sales_manager) manages Lucas + Camila (reps);
// Pieter is a rep in another team; Wei is read_only.
// Every rule created here is inactive, except one short-lived rule that only
// matches a source unique to this run; all temporary rows are removed in afterAll.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { testEnv } from "../support/env";
import { as, ctx } from "./context";

let service: SupabaseClient;
const created: Record<string, string[]> = {
  crm_assignment_rules: [],
  crm_stage_task_templates: [],
  crm_alert_rules: [],
  crm_notifications: [],
  crm_leads: [],
};
const tag = () => `rls-test:${ctx().run}`;

/** A write that RLS refuses fails with an error or touches no row. */
async function refused(p: PromiseLike<{ data: unknown; error: unknown }>) {
  const { data, error } = await p;
  return !!error || (Array.isArray(data) ? data.length === 0 : !data);
}

const ruleRow = (extra: Record<string, unknown> = {}) => ({
  name: `${tag()} rule`,
  active: false,
  target_type: "user",
  target_user_id: ctx().users.lucas,
  ...extra,
});

beforeAll(() => {
  const env = testEnv();
  service = createClient(env.url, env.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
});

afterAll(async () => {
  const leads = created.crm_leads;
  if (leads.length) {
    await service.from("crm_notifications").delete().in("record_id", leads);
    await service.from("crm_activities").delete().in("what_id", leads);
    await service.from("crm_leads").delete().in("id", leads);
    await service.from("crm_audit_logs").delete().in("record_id", leads);
  }
  for (const table of ["crm_notifications", "crm_assignment_rules", "crm_stage_task_templates", "crm_alert_rules"]) {
    const ids = created[table];
    if (!ids.length) continue;
    await service.from(table).delete().in("id", ids);
    if (table !== "crm_notifications") await service.from("crm_audit_logs").delete().in("record_id", ids);
  }
});

describe("assignment rules: who may read and write", () => {
  it("admin creates; manager views but cannot edit; reps and read_only see nothing and cannot write", async () => {
    const made = await as("admin").from("crm_assignment_rules").insert(ruleRow()).select("id").single();
    expect(made.error).toBeNull();
    const id = made.data!.id as string;
    created.crm_assignment_rules.push(id);

    const manager = await as("ricardo").from("crm_assignment_rules").select("id").eq("id", id);
    expect(manager.data?.map((r) => r.id)).toEqual([id]);
    expect(await refused(as("ricardo").from("crm_assignment_rules").insert(ruleRow()).select("id"))).toBe(true);
    expect(await refused(as("ricardo").from("crm_assignment_rules").update({ name: "x" }).eq("id", id).select("id"))).toBe(true);
    expect(await refused(as("ricardo").from("crm_assignment_rules").delete().eq("id", id).select("id"))).toBe(true);

    for (const actor of ["lucas", "pieter", "wei"] as const) {
      const seen = await as(actor).from("crm_assignment_rules").select("id").eq("id", id);
      expect(seen.data ?? []).toEqual([]);
      expect(await refused(as(actor).from("crm_assignment_rules").insert(ruleRow()).select("id"))).toBe(true);
      expect(await refused(as(actor).from("crm_assignment_rules").update({ name: "x" }).eq("id", id).select("id"))).toBe(true);
    }
  });

  it("stage task templates and alert rules follow the same rule", async () => {
    const stage = await service.from("crm_pipeline_stages").select("id, pipeline_id").eq("kind", "open").limit(1).single();
    expect(stage.error).toBeNull();
    const tpl = {
      stage_id: stage.data!.id,
      pipeline_id: stage.data!.pipeline_id,
      subject: `${tag()} template`,
      active: false,
    };
    const t = await as("admin").from("crm_stage_task_templates").insert(tpl).select("id").single();
    expect(t.error).toBeNull();
    created.crm_stage_task_templates.push(t.data!.id);
    expect(await refused(as("ricardo").from("crm_stage_task_templates").insert(tpl).select("id"))).toBe(true);
    expect(await refused(as("lucas").from("crm_stage_task_templates").insert(tpl).select("id"))).toBe(true);
    expect((await as("lucas").from("crm_stage_task_templates").select("id").eq("id", t.data!.id)).data ?? []).toEqual([]);
    expect(((await as("ricardo").from("crm_stage_task_templates").select("id").eq("id", t.data!.id)).data ?? []).length).toBe(1);

    // alert rules: seeded globals are readable by a manager, not by reps
    expect(((await as("ricardo").from("crm_alert_rules").select("id")).data ?? []).length).toBeGreaterThan(0);
    expect((await as("lucas").from("crm_alert_rules").select("id")).data ?? []).toEqual([]);
    expect(await refused(as("ricardo").from("crm_alert_rules").update({ threshold: 99 }).eq("kind", "stalled_deal").select("id"))).toBe(true);
    expect(await refused(as("lucas").from("crm_alert_rules").update({ threshold: 99 }).eq("kind", "stalled_deal").select("id"))).toBe(true);
  });

  it("reorder needs automation.edit", async () => {
    const ids = (await service.from("crm_assignment_rules").select("id").order("sort_order").order("id")).data!.map((r) => r.id);
    expect((await as("ricardo").rpc("crm_reorder_assignment_rules", { p_ids: ids })).error).not.toBeNull();
    expect((await as("lucas").rpc("crm_reorder_assignment_rules", { p_ids: ids })).error).not.toBeNull();
    // a partial list is rejected even for the admin (no sort_order is changed)
    expect((await as("admin").rpc("crm_reorder_assignment_rules", { p_ids: ids.slice(1) })).error?.code).toBe("22023");
  });

  it("clients cannot touch round-robin cursors", async () => {
    for (const actor of ["admin", "ricardo", "lucas"] as const) {
      const r = await as(actor).from("crm_assignment_cursors").select("rule_id");
      expect(r.error !== null || (r.data ?? []).length === 0).toBe(true);
      expect(await refused(as(actor).from("crm_assignment_cursors").insert({ rule_id: created.crm_assignment_rules[0] }).select("rule_id"))).toBe(true);
    }
  });
});

describe("notifications are private", () => {
  it("users read and mark only their own rows; clients cannot insert", async () => {
    const rows = await service
      .from("crm_notifications")
      .insert([
        { user_id: ctx().users.lucas, kind: "task_assigned", params: { subject: tag() } },
        { user_id: ctx().users.ricardo, kind: "task_assigned", params: { subject: tag() } },
      ])
      .select("id, user_id");
    expect(rows.error).toBeNull();
    const [mine, theirs] = [
      rows.data!.find((r) => r.user_id === ctx().users.lucas)!.id as string,
      rows.data!.find((r) => r.user_id === ctx().users.ricardo)!.id as string,
    ];
    created.crm_notifications.push(mine, theirs);

    const seen = (await as("lucas").from("crm_notifications").select("id").in("id", [mine, theirs])).data!.map((r) => r.id);
    expect(seen).toEqual([mine]);
    // not even an admin reads another user's notifications
    expect(((await as("admin").from("crm_notifications").select("id").in("id", [mine, theirs])).data ?? []).length).toBe(0);

    expect(await refused(as("lucas").from("crm_notifications").update({ read_at: new Date().toISOString() }).eq("id", theirs).select("id"))).toBe(true);
    const ok = await as("lucas").from("crm_notifications").update({ read_at: new Date().toISOString() }).eq("id", mine).select("id");
    expect(ok.error).toBeNull();
    expect(ok.data?.length).toBe(1);
    // only read_at is writable
    expect((await as("lucas").from("crm_notifications").update({ kind: "lead_assigned" }).eq("id", mine).select("id")).error).not.toBeNull();

    const forged = await as("lucas")
      .from("crm_notifications")
      .insert({ user_id: ctx().users.lucas, kind: "lead_assigned", params: {} })
      .select("id");
    expect(forged.error).not.toBeNull();
    expect(await refused(as("lucas").from("crm_notifications").delete().eq("id", mine).select("id"))).toBe(true);
  });
});

describe("RPC grants", () => {
  it("authenticated users cannot call the runner or internal helpers", async () => {
    const calls: [string, Record<string, unknown>][] = [
      ["crm_run_automation", { p_trigger: "manual" }],
      ["crm_assign_lead_owner", { p_country: "BR", p_entity: null, p_source: null }],
      ["crm_automation_begin", { p_ctx: {} }],
      ["crm_automation_end", { p_prev: {} }],
      ["crm_notify", { p_user: ctx().users.lucas, p_kind: "lead_assigned", p_params: {}, p_object: null, p_record: null }],
    ];
    for (const actor of ["admin", "lucas"] as const) {
      for (const [fn, args] of calls) {
        const res = await as(actor).rpc(fn, args);
        expect(res.error, `${actor} ${fn}`).not.toBeNull();
      }
    }
  });
});

describe("crm_apply_assignment_rules", () => {
  it("fails without leads.edit, on an invisible lead and on a converted lead", async () => {
    const lead = await service
      .from("crm_leads")
      .insert({
        last_name: `${tag()} converted`,
        owner_id: ctx().users.lucas,
        status: "qualified",
        converted_at: new Date().toISOString(),
        external_ref: `${tag()}:automation:converted`,
      })
      .select("id")
      .single();
    expect(lead.error).toBeNull();
    created.crm_leads.push(lead.data!.id);

    const noEdit = await as("wei").rpc("crm_apply_assignment_rules", { p_lead_id: lead.data!.id });
    expect(noEdit.error?.code).toBe("42501");
    const invisible = await as("pieter").rpc("crm_apply_assignment_rules", { p_lead_id: lead.data!.id });
    expect(invisible.error?.code).toBe("P0002");
    const converted = await as("lucas").rpc("crm_apply_assignment_rules", { p_lead_id: lead.data!.id });
    expect(converted.error?.message).toContain("lead_converted");
    const missing = await as("lucas").rpc("crm_apply_assignment_rules", { p_lead_id: "00000000-0000-4000-8000-00000000dead" });
    expect(missing.error?.code).toBe("P0002");
  });

  it("previews: for-lead needs leads.edit and visibility; free-form needs automation.view", async () => {
    const leadId = created.crm_leads[0];
    const own = await as("lucas").rpc("crm_assignment_preview_for_lead", { p_lead_id: leadId });
    expect(own.error).toBeNull();
    expect(Object.keys(own.data as object).sort()).toEqual(["owner_id", "via"]);
    expect((await as("pieter").rpc("crm_assignment_preview_for_lead", { p_lead_id: leadId })).error?.code).toBe("P0002");
    expect((await as("wei").rpc("crm_assignment_preview_for_lead", { p_lead_id: leadId })).error?.code).toBe("42501");
    const args = { p_country: "BR", p_entity: null, p_source: null };
    expect((await as("ricardo").rpc("crm_assignment_preview", args)).error).toBeNull();
    expect((await as("lucas").rpc("crm_assignment_preview", args)).error?.code).toBe("42501");
  });
});

describe("Automation attribution", () => {
  it("an inbound-style insert is assigned by a rule and audited as Automation with a null actor", async () => {
    const source = `${tag()}:src`;
    const rule = await service
      .from("crm_assignment_rules")
      .insert({
        name: `${tag()} inbound`,
        active: true,
        sources: [source],
        target_type: "user",
        target_user_id: ctx().users.ricardo,
        stop_processing: true,
        sort_order: -1,
      })
      .select("id")
      .single();
    expect(rule.error).toBeNull();
    created.crm_assignment_rules.push(rule.data!.id);
    try {
      const lead = await service
        .from("crm_leads")
        .insert({ last_name: `${tag()} inbound`, source, external_ref: `${tag()}:automation:inbound` })
        .select("id, owner_id")
        .single();
      expect(lead.error).toBeNull();
      created.crm_leads.push(lead.data!.id);
      expect(lead.data!.owner_id).toBe(ctx().users.ricardo);

      const audit = await service
        .from("crm_audit_logs")
        .select("actor_id, actor_name, action, context")
        .eq("object", "lead")
        .eq("record_id", lead.data!.id)
        .eq("action", "create")
        .single();
      expect(audit.data?.actor_id).toBeNull();
      expect(audit.data?.actor_name).toBe("Automation");
      expect(audit.data?.context).toMatchObject({ kind: "assignment", rule_id: rule.data!.id });

      const note = await service
        .from("crm_notifications")
        .select("id")
        .eq("record_id", lead.data!.id)
        .eq("user_id", ctx().users.ricardo)
        .eq("kind", "lead_assigned");
      expect(note.data?.length).toBe(1);
    } finally {
      await service.from("crm_assignment_rules").delete().eq("id", rule.data!.id);
    }
  });

  it("a later user write on that lead is attributed to the user, not Automation", async () => {
    const leadId = created.crm_leads.at(-1)!;
    const upd = await as("ricardo").from("crm_leads").update({ company: `${tag()} co` }).eq("id", leadId).select("id");
    expect(upd.error).toBeNull();
    const audit = await service
      .from("crm_audit_logs")
      .select("actor_id, actor_name, context")
      .eq("object", "lead")
      .eq("record_id", leadId)
      .eq("action", "update")
      .order("id", { ascending: false })
      .limit(1)
      .single();
    expect(audit.data?.actor_id).toBe(ctx().users.ricardo);
    expect(audit.data?.actor_name).not.toBe("Automation");
    expect(audit.data?.context).toBeNull();
  });
});
