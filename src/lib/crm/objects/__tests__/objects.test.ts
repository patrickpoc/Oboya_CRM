import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/lib/crm/csv";
import { accountConfig } from "@/lib/crm/objects/account";
import { RULE_CODES, isRuleCode, mapDbError, ruleError } from "@/lib/crm/objects/errors";
import enRecord from "../../../../../messages/en/record.json";
import {
  buildSearchFilter,
  escapeLike,
  listParamsKey,
  parseListQuery,
  quoteFilterValue,
} from "@/lib/crm/objects/query";
import { buildSchema } from "@/lib/crm/objects/schema";
import type { RecordConfig } from "@/lib/crm/objects/types";

const ENTITY = "00000000-0000-4000-8000-000000000201";
const ENTITY_2 = "00000000-0000-4000-8000-000000000202";

const typed: RecordConfig = {
  ...accountConfig,
  fields: [
    { key: "name", labelKey: "n", type: "text", required: true },
    { key: "email", labelKey: "e", type: "email" },
    { key: "website", labelKey: "w", type: "url" },
    { key: "amount", labelKey: "a", type: "currency" },
    { key: "probability", labelKey: "p", type: "percent" },
    { key: "close_date", labelKey: "d", type: "date" },
    { key: "country_code", labelKey: "c", type: "country" },
    { key: "tags", labelKey: "t", type: "tags" },
    { key: "active", labelKey: "b", type: "boolean" },
    { key: "readonly", labelKey: "r", type: "text", editable: false },
  ],
};

describe("buildSchema", () => {
  it("requires required fields on create", () => {
    const result = buildSchema(accountConfig, "create").safeParse({ type: "customer" });
    expect(result.success).toBe(false);
    expect(buildSchema(accountConfig, "create").safeParse({ name: "  ", type: "customer" }).success).toBe(false);
    expect(buildSchema(accountConfig, "create").safeParse({ name: "Acme", type: "customer" }).success).toBe(true);
  });

  it("strips unknown and non-editable keys", () => {
    const parsed = buildSchema(typed, "create").parse({
      name: "Acme",
      readonly: "x",
      owner_hack: "y",
      deleted_at: "2020-01-01",
    });
    expect(parsed).toEqual({ name: "Acme" });
  });

  it("validates and normalizes types", () => {
    const parsed = buildSchema(typed, "create").parse({
      name: " Acme ",
      email: "Sales@Acme.COM",
      website: "acme.com",
      amount: "1234.567",
      probability: 40,
      close_date: "2026-12-01",
      country_code: "br",
      tags: ["VIP", " vip ", "Export"],
      active: true,
    });
    expect(parsed).toMatchObject({
      name: "Acme",
      email: "sales@acme.com",
      website: "https://acme.com",
      amount: 1234.57,
      probability: 40,
      country_code: "BR",
      tags: ["vip", "export"],
      active: true,
    });
    const bad = buildSchema(typed, "create");
    expect(bad.safeParse({ name: "A", email: "nope" }).success).toBe(false);
    expect(bad.safeParse({ name: "A", probability: 101 }).success).toBe(false);
    expect(bad.safeParse({ name: "A", close_date: "01/12/2026" }).success).toBe(false);
    expect(bad.safeParse({ name: "A", website: "javascript:alert(1)" }).success).toBe(false);
    expect(bad.safeParse({ name: "A", country_code: "BRA" }).success).toBe(false);
  });

  it("rejects static picklist values outside the enum", () => {
    expect(buildSchema(accountConfig, "update").safeParse({ type: "vendor" }).success).toBe(false);
    expect(buildSchema(accountConfig, "update").safeParse({ type: "partner" }).success).toBe(true);
  });

  it("update is partial, maps '' to null for optional fields, and needs one field", () => {
    const update = buildSchema(accountConfig, "update");
    expect(update.parse({ phone: "" })).toEqual({ phone: null });
    expect(update.safeParse({ name: null }).success).toBe(false);
    expect(update.safeParse({}).success).toBe(false);
    expect(update.safeParse({ unknown: 1 }).success).toBe(false);
  });

  it("validates entity links (one primary, no duplicates)", () => {
    const update = buildSchema(accountConfig, "update");
    expect(
      update.safeParse({ entities: [{ entityId: ENTITY, isPrimary: true }, { entityId: ENTITY_2, isPrimary: false }] }).success
    ).toBe(true);
    expect(
      update.safeParse({ entities: [{ entityId: ENTITY, isPrimary: true }, { entityId: ENTITY_2, isPrimary: true }] }).success
    ).toBe(false);
    expect(
      update.safeParse({ entities: [{ entityId: ENTITY, isPrimary: true }, { entityId: ENTITY, isPrimary: false }] }).success
    ).toBe(false);
    expect(update.parse({ entities: null })).toEqual({ entities: [] });
  });
});

describe("parseListQuery", () => {
  it("whitelists sort keys and falls back to the default sort", () => {
    const q = parseListQuery(accountConfig, new URLSearchParams("sort=deleted_at&dir=asc"));
    expect(q.sort).toBe("name");
    expect(parseListQuery(accountConfig, new URLSearchParams("sort=created_at&dir=desc")).sort).toBe("created_at");
    expect(parseListQuery(accountConfig, new URLSearchParams("dir=sideways")).dir).toBe("asc");
  });

  it("keeps only filterable keys with valid values", () => {
    const q = parseListQuery(
      accountConfig,
      new URLSearchParams(
        `type=customer,bogus,partner&owner_id=not-a-uuid&deleted_at=x&website=a.com&country_code=br&entities=${ENTITY}`
      )
    );
    expect(q.filters).toEqual({ type: ["customer", "partner"], country_code: ["BR"], entities: [ENTITY] });
  });

  it("clamps paging and defaults the view", () => {
    const q = parseListQuery(accountConfig, new URLSearchParams("page=-3&pageSize=5000&view=hacked"));
    expect(q).toMatchObject({ page: 0, pageSize: 100, view: "mine" });
    expect(parseListQuery(accountConfig, new URLSearchParams("view=recent")).view).toBe("recent");
  });

  it("builds a canonical key from known params only", () => {
    expect(listParamsKey(accountConfig, { type: "customer", view: "all", junk: "1", q: "" })).toBe("type=customer&view=all");
  });
});

describe("search escaping", () => {
  it("escapes LIKE metacharacters", () => {
    expect(escapeLike("100%_a\\b")).toBe("100\\%\\_a\\\\b");
  });

  it("quotes PostgREST values", () => {
    expect(quoteFilterValue('a,b"c')).toBe('"a,b\\"c"');
  });

  it("builds an or-filter over searchable columns only", () => {
    const filter = buildSearchFilter(accountConfig, "ac%me,(x)*");
    expect(filter).toContain('name.ilike."%ac\\\\%me,(x)%"');
    expect(filter).toContain("email.ilike.");
    expect(filter).not.toContain("description");
    expect(filter).not.toContain("*");
    expect(buildSearchFilter(accountConfig, "   ")).toBeNull();
  });
});

describe("csv", () => {
  it("escapes quotes, commas and newlines", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("a\nb")).toBe('"a\nb"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(12)).toBe("12");
    expect(csvCell(["a", "b"])).toBe("a|b");
  });

  it("neutralizes formulas but not negative numbers", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell(-5)).toBe("-5");
  });

  it("writes a BOM, header and rows", () => {
    expect(toCsv(["id", "name"], [["1", "Acme, Inc"]])).toBe('﻿id,name\n1,"Acme, Inc"\n');
  });
});

describe("mapDbError", () => {
  it("maps codes to safe statuses", () => {
    expect(mapDbError({ code: "42501", message: "secret" })).toEqual({ status: 403, body: { error: "Forbidden", code: "forbidden" } });
    expect(mapDbError({ code: "23505" }).body.code).toBe("duplicate");
    expect(mapDbError({ code: "P0001", message: "loss_reason_required" })).toEqual({
      status: 422,
      body: { error: "loss_reason_required", code: "loss_reason_required" },
    });
    // Unknown trigger/RPC text is never returned: generic `rule`.
    expect(mapDbError({ code: "P0001", message: "Some internal detail" })).toEqual({
      status: 422,
      body: { error: "Invalid value", code: "rule" },
    });
    expect(mapDbError({ code: "23514", message: 'new row for relation "crm_accounts" violates check constraint' }).body.error).toBe(
      "Invalid value"
    );
    expect(mapDbError({ code: "XX000", message: "internal" }).status).toBe(500);
  });
});

describe("rule error codes", () => {
  it("returns each known P0001 code as the response code", () => {
    for (const code of RULE_CODES) {
      expect(mapDbError({ code: "P0001", message: code })).toEqual({ status: 422, body: { error: code, code } });
      expect(isRuleCode(code)).toBe(true);
    }
    expect(ruleError("  one_primary_required ").body.code).toBe("one_primary_required");
    expect(ruleError(undefined).body).toEqual({ error: "Invalid value", code: "rule" });
  });

  it("has UI copy (record.errors.rules.<code>) for every code the API returns", () => {
    const rules = (enRecord as { errors: { rules: Record<string, string>; rule: string } }).errors;
    for (const code of [...RULE_CODES, "duplicate", "forbidden"]) expect(rules.rules[code]).toBeTruthy();
    // The generic message never interpolates server text.
    expect(rules.rule).not.toContain("{");
  });
});
