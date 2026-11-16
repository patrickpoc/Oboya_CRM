// Read visibility per role and object, with real user JWTs.
// Teams (seed): Ricardo manages Lucas + Camila; Sanne manages Pieter.
import { describe, expect, it } from "vitest";
import { OBJECTS, anon, as, ctx, visibleIds, type Actor, type Fixture } from "./context";

type Owner = "lucas" | "camila" | "ricardo" | "pieter";
const OWNERS: Owner[] = ["lucas", "camila", "ricardo", "pieter"];

const EXPECTED: Record<Actor, Owner[]> = {
  lucas: ["lucas"],
  camila: ["camila"],
  pieter: ["pieter"],
  ricardo: ["lucas", "camila", "ricardo"],
  sanne: ["pieter"],
  wei: OWNERS,
  admin: OWNERS,
};

function fixtureOf(owner: Owner): Fixture {
  return ctx().fixtures[owner];
}

describe.each(OBJECTS)("$table visibility", ({ key, table }) => {
  const allIds = () => OWNERS.map((owner) => fixtureOf(owner)[key]);

  it.each(Object.entries(EXPECTED) as [Actor, Owner[]][])(
    "%s sees exactly the expected owners' records",
    async (actor, owners) => {
      const expected = owners.map((owner) => fixtureOf(owner)[key]).sort();
      expect(await visibleIds(as(actor), table, allIds())).toEqual(expected);
    },
  );

  it("rep does not see another rep's record (same team or not)", async () => {
    const seen = await visibleIds(as("lucas"), table, allIds());
    expect(seen).not.toContain(fixtureOf("camila")[key]);
    expect(seen).not.toContain(fixtureOf("pieter")[key]);
  });

  it("manager sees own + team but not another team", async () => {
    const ricardo = await visibleIds(as("ricardo"), table, allIds());
    expect(ricardo).toContain(fixtureOf("ricardo")[key]);
    expect(ricardo).toContain(fixtureOf("lucas")[key]);
    expect(ricardo).not.toContain(fixtureOf("pieter")[key]);
    const sanne = await visibleIds(as("sanne"), table, allIds());
    expect(sanne).toContain(fixtureOf("pieter")[key]);
    expect(sanne).not.toContain(fixtureOf("lucas")[key]);
  });

  it("anon gets nothing", async () => {
    const { data, error } = await anon().from(table).select("id").in("id", allIds());
    // Table privileges are revoked from anon: an error, or at worst no rows.
    expect(error !== null || (data ?? []).length === 0).toBe(true);
    expect(data ?? []).toHaveLength(0);
  });
});

describe("anon on the user directory and RPCs", () => {
  it("anon cannot read crm_users", async () => {
    const { data } = await anon().from("crm_users").select("id").limit(1);
    expect(data ?? []).toHaveLength(0);
  });

  it("anon cannot call crm_soft_delete", async () => {
    const { error } = await anon().rpc("crm_soft_delete", {
      p_object: "lead",
      p_id: fixtureOf("lucas").lead,
    });
    expect(error).not.toBeNull();
  });
});
