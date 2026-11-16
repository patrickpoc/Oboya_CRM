// Audit visibility, lead conversion checks and soft delete through the RPCs.
import { describe, expect, it } from "vitest";
import { OBJECTS, as, ctx, visibleIds, type Actor } from "./context";

function liveFixtureIds(owners: ("lucas" | "camila" | "ricardo" | "pieter")[]): string[] {
  const { fixtures } = ctx();
  return owners.flatMap((owner) => Object.values(fixtures[owner]));
}

describe("crm_audit_logs", () => {
  it("rep cannot read audit logs", async () => {
    const ids = liveFixtureIds(["lucas", "camila", "ricardo", "pieter"]);
    const { data, error } = await as("lucas").from("crm_audit_logs").select("id").in("record_id", ids);
    expect(error !== null || (data ?? []).length === 0).toBe(true);
    expect(data ?? []).toHaveLength(0);
  });

  it("manager reads only audit rows of visible records", async () => {
    const visible = new Set(liveFixtureIds(["lucas", "camila", "ricardo"]));
    const hidden = new Set(liveFixtureIds(["pieter"]));
    const { data, error } = await as("ricardo")
      .from("crm_audit_logs")
      .select("record_id")
      .in("record_id", [...visible, ...hidden]);
    expect(error).toBeNull();
    const records = new Set((data ?? []).map((row: { record_id: string }) => row.record_id));
    // Every fixture insert is audited, so each visible record has a row.
    for (const id of visible) expect(records.has(id)).toBe(true);
    for (const id of hidden) expect(records.has(id)).toBe(false);
  });

  it("admin reads audit rows of every record", async () => {
    const ids = liveFixtureIds(["lucas", "pieter"]);
    const { data, error } = await as("admin").from("crm_audit_logs").select("record_id").in("record_id", ids);
    expect(error).toBeNull();
    expect(new Set((data ?? []).map((row: { record_id: string }) => row.record_id))).toEqual(new Set(ids));
  });

  it("nobody can write audit logs from a client", async () => {
    const { error } = await as("admin").from("crm_audit_logs").insert({
      object: "lead",
      record_id: ctx().fixtures.lucas.lead,
      action: "update",
    });
    expect(error).not.toBeNull();
  });
});

describe("crm_convert_lead", () => {
  async function convertedAt(id: string) {
    const { data } = await as("admin").from("crm_leads").select("converted_at").eq("id", id).single();
    return data?.converted_at ?? null;
  }

  it.each([
    ["another team's lead", "pieter"],
    ["a same-team colleague's lead", "camila"],
  ] as const)("rep converting %s fails", async (_label, owner) => {
    const leadId = ctx().fixtures[owner].lead;
    const { data, error } = await as("lucas").rpc("crm_convert_lead", {
      p_lead_id: leadId,
      p_create_opportunity: true,
      p_opportunity_name: `rls convert probe ${ctx().run}`,
    });
    expect(error).not.toBeNull();
    expect(data).toBeNull();
    expect(await convertedAt(leadId)).toBeNull();
  });

  it("read_only cannot convert a lead it can see", async () => {
    const leadId = ctx().fixtures.lucas.lead;
    const { error } = await as("wei").rpc("crm_convert_lead", {
      p_lead_id: leadId,
      p_create_opportunity: false,
    });
    expect(error?.code).toBe("42501");
    expect(await convertedAt(leadId)).toBeNull();
  });
});

describe("crm_soft_delete", () => {
  it("rep cannot soft-delete another rep's record", async () => {
    const { error } = await as("lucas").rpc("crm_soft_delete", {
      p_object: "activity",
      p_id: ctx().fixtures.pieter.activity,
    });
    expect(error).not.toBeNull();
  });

  it("read_only cannot soft-delete", async () => {
    const { error } = await as("wei").rpc("crm_soft_delete", {
      p_object: "lead",
      p_id: ctx().fixtures.pieter.lead,
    });
    expect(error?.code).toBe("42501");
  });

  // Activities first, then the parents (the order the UI would use).
  const order = ["activity", "opportunity", "lead", "contact", "account"] as const;
  const tables = Object.fromEntries(OBJECTS.map((o) => [o.key, o.table]));

  it.each(order)("manager soft-deletes a team %s; hidden from non-admins, visible to admin", async (key) => {
    const id = ctx().fixtures.lucasDeletable[key];
    const table = tables[key];
    expect(await visibleIds(as("lucas"), table, [id])).toEqual([id]);

    const { error } = await as("ricardo").rpc("crm_soft_delete", { p_object: key, p_id: id });
    expect(error).toBeNull();

    for (const actor of ["lucas", "ricardo", "wei", "camila"] as Actor[]) {
      expect(await visibleIds(as(actor), table, [id])).toEqual([]);
    }
    const { data } = await as("admin").from(table).select("id, deleted_at, deleted_by").eq("id", id).single();
    expect(data?.deleted_at).not.toBeNull();
    expect(data?.deleted_by).toBe(ctx().users.ricardo);
  });

  it("a deleted record cannot be soft-deleted again or edited by its owner", async () => {
    const id = ctx().fixtures.lucasDeletable.lead;
    const again = await as("ricardo").rpc("crm_soft_delete", { p_object: "lead", p_id: id });
    expect(again.error).not.toBeNull();
    const { data, error } = await as("lucas")
      .from("crm_leads")
      .update({ company: "edit after delete" })
      .eq("id", id)
      .select("id");
    expect(error !== null || (data ?? []).length === 0).toBe(true);
  });

  it("only the admin can restore", async () => {
    const id = ctx().fixtures.lucasDeletable.activity;
    const manager = await as("ricardo").rpc("crm_restore", { p_object: "activity", p_id: id });
    expect(manager.error?.code).toBe("42501");
    const admin = await as("admin").rpc("crm_restore", { p_object: "activity", p_id: id });
    expect(admin.error).toBeNull();
  });
});
