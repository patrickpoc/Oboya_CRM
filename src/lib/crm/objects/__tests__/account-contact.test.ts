import { describe, expect, it } from "vitest";
import { accountConfig } from "@/lib/crm/objects/account";
import { contactConfig } from "@/lib/crm/objects/contact";
import { getField } from "@/lib/crm/objects/query";
import { getRecordConfig } from "@/lib/crm/objects/registry";
import { buildSchema } from "@/lib/crm/objects/schema";
import { RESERVED_QUERY_KEYS, type RecordConfig } from "@/lib/crm/objects/types";

const ACCOUNT = "00000000-0000-4000-8000-000000000101";
const E1 = "00000000-0000-4000-8000-000000000201";
const E2 = "00000000-0000-4000-8000-000000000202";

function consistent(config: RecordConfig) {
  const keys = config.fields.map((f) => f.key);
  expect(new Set(keys).size).toBe(keys.length);
  for (const k of [...config.highlights, ...config.listColumns]) expect(getField(config, k), k).toBeDefined();
  for (const k of keys) expect((RESERVED_QUERY_KEYS as readonly string[]).includes(k)).toBe(false);
}

describe("account config", () => {
  const create = buildSchema(accountConfig, "create");

  it("is registered and consistent", () => {
    expect(getRecordConfig("account")).toBe(accountConfig);
    consistent(accountConfig);
    expect(accountConfig.highlights).toEqual(["type", "primary_entity", "country_code"]);
  });

  it("requires name and type, defaults nothing else", () => {
    expect(create.safeParse({}).success).toBe(false);
    expect(create.safeParse({ name: "Acme" }).success).toBe(false);
    expect(create.safeParse({ name: "Acme", type: "vendor" }).success).toBe(false);
    expect(create.safeParse({ name: "Acme", type: "distributor" }).success).toBe(true);
  });

  it("never writes the derived primary_entity", () => {
    const parsed = create.parse({ name: "Acme", type: "customer", primary_entity: E1 });
    expect(parsed).not.toHaveProperty("primary_entity");
  });

  it("requires exactly one primary entity when entities are set", () => {
    const base = { name: "Acme", type: "customer" };
    expect(create.safeParse({ ...base, entities: [] }).success).toBe(true);
    expect(
      create.safeParse({ ...base, entities: [{ entityId: E1, isPrimary: true }, { entityId: E2, isPrimary: false }] })
        .success
    ).toBe(true);
    const none = create.safeParse({
      ...base,
      entities: [{ entityId: E1, isPrimary: false }, { entityId: E2, isPrimary: false }],
    });
    expect(none.success).toBe(false);
    expect(none.error?.issues[0]?.message).toBe("one_primary_required");
    expect(
      create.safeParse({ ...base, entities: [{ entityId: E1, isPrimary: true }, { entityId: E2, isPrimary: true }] })
        .success
    ).toBe(false);
    expect(create.safeParse({ ...base, entities: [{ entityId: "nope", isPrimary: true }] }).success).toBe(false);
  });

  it("filters on type, country, segment, entity and owner", () => {
    const filterable = accountConfig.fields.filter((f) => f.filterable).map((f) => f.key);
    expect(filterable).toEqual(
      expect.arrayContaining(["type", "country_code", "segment", "entities", "owner_id"])
    );
  });
});

describe("contact config", () => {
  const create = buildSchema(contactConfig, "create");
  const update = buildSchema(contactConfig, "update");

  it("is registered and consistent", () => {
    expect(getRecordConfig("contact")).toBe(contactConfig);
    consistent(contactConfig);
  });

  it("requires last name and account on create", () => {
    expect(create.safeParse({ last_name: "Silva" }).success).toBe(false);
    expect(create.safeParse({ account_id: ACCOUNT }).success).toBe(false);
    expect(create.safeParse({ last_name: "Silva", account_id: "" }).success).toBe(false);
    expect(create.safeParse({ last_name: "Silva", account_id: "not-a-uuid" }).success).toBe(false);
    expect(create.parse({ last_name: " Silva ", account_id: ACCOUNT, first_name: "" })).toEqual({
      last_name: "Silva",
      account_id: ACCOUNT,
      first_name: null,
    });
  });

  it("rejects clearing the account on update and never writes full_name", () => {
    expect(update.safeParse({ account_id: null }).success).toBe(false);
    expect(update.safeParse({ full_name: "X" }).success).toBe(false);
    expect(update.safeParse({ title: "Buyer" }).success).toBe(true);
  });

  it("lists opportunities where the contact is primary", () => {
    expect(contactConfig.relatedLists.map((r) => [r.object, r.foreignKey])).toEqual([
      ["opportunity", "primary_contact_id"],
    ]);
    expect(getField(contactConfig, "account_id")?.filterable).toBe(true);
  });
});
