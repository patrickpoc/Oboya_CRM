// Write rules: read_only never writes, reps only touch visible rows, owner and
// reference changes must point at visible records, no self-promotion.
import { describe, expect, it } from "vitest";
import { OBJECTS, as, ctx, type ObjectKey } from "./context";

const PIPELINE = "00000000-0000-4000-8000-000000000001";
const STAGE_PROSPECTING = "00000000-0000-4000-8000-000000000101";

// A harmless text column per object, used for update probes.
const TEXT_FIELD: Record<ObjectKey, string> = {
  lead: "company",
  account: "description",
  contact: "title",
  opportunity: "next_step",
  activity: "body",
};

function insertPayload(key: ObjectKey): Record<string, unknown> {
  const { ref, fixtures } = ctx();
  switch (key) {
    case "lead":
      return { last_name: "rls probe", email: `rls-probe-${ctx().run}@example.com`, external_ref: `${ref}:probe-${key}` };
    case "account":
      return { name: "rls probe", external_ref: `${ref}:probe-${key}` };
    case "contact":
      return { last_name: "rls probe", external_ref: `${ref}:probe-${key}` };
    case "opportunity":
      return {
        name: "rls probe",
        account_id: fixtures.lucas.account,
        pipeline_id: PIPELINE,
        stage_id: STAGE_PROSPECTING,
        external_ref: `${ref}:probe-${key}`,
      };
    case "activity":
      return { type: "note", subject: "rls probe", external_ref: `${ref}:probe-${key}` };
  }
}

async function readField(table: string, id: string, field: string) {
  const { data, error } = await as("admin").from(table).select(`${field}, owner_id`).eq("id", id).single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data as unknown as Record<string, unknown>;
}

describe.each(OBJECTS)("$table writes", ({ key, table }) => {
  it("read_only cannot insert", async () => {
    const { data, error } = await as("wei").from(table).insert(insertPayload(key)).select("id");
    expect(error).not.toBeNull();
    expect(data ?? []).toHaveLength(0);
  });

  it("read_only cannot update a record it can see", async () => {
    const id = ctx().fixtures.lucas[key];
    const field = TEXT_FIELD[key];
    const before = await readField(table, id, field);
    const { error } = await as("wei")
      .from(table)
      .update({ [field]: "changed by read_only" })
      .eq("id", id)
      .select("id");
    expect(error).not.toBeNull();
    expect((await readField(table, id, field))[field]).toEqual(before[field]);
  });

  it("rep cannot update another rep's record", async () => {
    const field = TEXT_FIELD[key];
    for (const owner of ["camila", "pieter"] as const) {
      const id = ctx().fixtures[owner][key];
      const before = await readField(table, id, field);
      const { data, error } = await as("lucas")
        .from(table)
        .update({ [field]: "changed by lucas" })
        .eq("id", id)
        .select("id");
      expect(error !== null || (data ?? []).length === 0).toBe(true);
      expect((await readField(table, id, field))[field]).toEqual(before[field]);
    }
  });

  it("rep cannot reassign own record to an invisible owner", async () => {
    const id = ctx().fixtures.lucas[key];
    const { error } = await as("lucas")
      .from(table)
      .update({ owner_id: ctx().users.pieter })
      .eq("id", id)
      .select("id");
    expect(error).not.toBeNull();
    expect(error?.code).toBe("42501");
    expect((await readField(table, id, "id")).owner_id).toBe(ctx().users.lucas);
  });

  it("rep can update own record (control)", async () => {
    const id = ctx().fixtures.lucas[key];
    const field = TEXT_FIELD[key];
    const { data, error } = await as("lucas")
      .from(table)
      .update({ [field]: `own edit ${ctx().run}` })
      .eq("id", id)
      .select("id");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
  });
});

describe("references must be visible (42501)", () => {
  it("rep cannot create a contact on an invisible account", async () => {
    const { error } = await as("lucas")
      .from("crm_contacts")
      .insert({ last_name: "rls link probe", account_id: ctx().fixtures.pieter.account, external_ref: `${ctx().ref}:link-contact` })
      .select("id");
    expect(error?.code).toBe("42501");
  });

  it("rep cannot move own opportunity to an invisible account", async () => {
    const { error } = await as("lucas")
      .from("crm_opportunities")
      .update({ account_id: ctx().fixtures.pieter.account })
      .eq("id", ctx().fixtures.lucas.opportunity)
      .select("id");
    expect(error?.code).toBe("42501");
  });

  it("rep cannot link own contact to a same-team colleague's account", async () => {
    const { error } = await as("lucas")
      .from("crm_contacts")
      .update({ account_id: ctx().fixtures.camila.account })
      .eq("id", ctx().fixtures.lucas.contact)
      .select("id");
    expect(error?.code).toBe("42501");
  });

  it("rep cannot attach an activity to an invisible lead", async () => {
    const { error } = await as("lucas")
      .from("crm_activities")
      .insert({
        type: "note",
        subject: "rls link probe",
        what_object: "lead",
        what_id: ctx().fixtures.pieter.lead,
        external_ref: `${ctx().ref}:link-activity`,
      })
      .select("id");
    expect(error?.code).toBe("42501");
  });
});

describe("privilege escalation", () => {
  it("rep cannot change their own crm_users.role", async () => {
    const { lucas } = ctx().users;
    const { error } = await as("lucas")
      .from("crm_users")
      .update({ role: "super_admin" })
      .eq("id", lucas)
      .select("id");
    expect(error).not.toBeNull();
    const { data } = await as("admin").from("crm_users").select("role").eq("id", lucas).single();
    expect(data?.role).toBe("sales_rep");
  });

  it("rep cannot change their own status or team", async () => {
    const { lucas } = ctx().users;
    const { error } = await as("lucas")
      .from("crm_users")
      .update({ team_id: null })
      .eq("id", lucas)
      .select("id");
    expect(error).not.toBeNull();
  });

  it("rep cannot set converted_at directly", async () => {
    const { error } = await as("lucas")
      .from("crm_leads")
      .update({ converted_at: new Date().toISOString(), status: "qualified" })
      .eq("id", ctx().fixtures.lucas.lead)
      .select("id");
    expect(error?.code).toBe("42501");
  });
});
