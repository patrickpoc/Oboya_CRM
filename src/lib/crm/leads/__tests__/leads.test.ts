import { describe, expect, it } from "vitest";
import {
  convertLeadSchema,
  convertTarget,
  defaultOpportunityName,
  mapConvertError,
  parseConvertResult,
  toConvertRpcArgs,
} from "@/lib/crm/leads/convert";
import { leadSlaState, parseSlaHours, slaFromRows, DEFAULT_SLA_HOURS } from "@/lib/crm/leads/sla";
import { LEAD_RULE_ERRORS, applyLeadUpdateRules, leadStatusPatch, leadStatusSchema } from "@/lib/crm/leads/status";
import { isRuleCode } from "@/lib/crm/objects/errors";
import { recordAccess } from "@/lib/crm/objects/record-access";
import { leadConfig } from "@/lib/crm/objects/lead";
import { parseListQuery } from "@/lib/crm/objects/query";
import { buildSchema } from "@/lib/crm/objects/schema";

const LEAD = "00000000-0000-4000-8000-000000000001";
const ACCOUNT = "00000000-0000-4000-8000-000000000002";
const NOW = Date.parse("2026-11-16T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 36e5).toISOString();

describe("slaFromRows", () => {
  it("computes SLA from the loaded row columns with the configured hours", () => {
    const rows = [
      { id: "a", status: "new", created_at: hoursAgo(5), first_responded_at: null },
      { id: "b", status: "new", created_at: hoursAgo(13), first_responded_at: null },
      { id: "c", status: "new", created_at: hoursAgo(30), first_responded_at: null },
      { id: "d", status: "working", created_at: hoursAgo(30), first_responded_at: hoursAgo(1) },
    ];
    const out = slaFromRows(rows, NOW, { warning: 12, overdue: 24 });
    expect(Object.fromEntries(out)).toEqual({ a: "on_track", b: "warning", c: "overdue", d: null });
    expect(slaFromRows(rows, NOW, DEFAULT_SLA_HOURS).get("c")).toBe("warning");
  });
});

describe("leadSlaState", () => {
  it("is on track, warning at 24h and overdue at 48h while new and unanswered", () => {
    expect(leadSlaState({ status: "new", created_at: hoursAgo(1) }, NOW)).toBe("on_track");
    expect(leadSlaState({ status: "new", created_at: hoursAgo(23.9) }, NOW)).toBe("on_track");
    expect(leadSlaState({ status: "new", created_at: hoursAgo(24) }, NOW)).toBe("warning");
    expect(leadSlaState({ status: "new", created_at: hoursAgo(47.9) }, NOW)).toBe("warning");
    expect(leadSlaState({ status: "new", created_at: hoursAgo(48) }, NOW)).toBe("overdue");
  });

  it("does not apply once responded or out of new", () => {
    expect(leadSlaState({ status: "new", created_at: hoursAgo(72), first_responded_at: hoursAgo(1) }, NOW)).toBeNull();
    expect(leadSlaState({ status: "working", created_at: hoursAgo(72) }, NOW)).toBeNull();
    expect(leadSlaState({ status: "new", created_at: "nope" }, NOW)).toBeNull();
  });

  it("uses thresholds from settings and falls back on invalid ones", () => {
    expect(leadSlaState({ status: "new", created_at: hoursAgo(5) }, NOW, parseSlaHours({ warning: 4, overdue: 8 }))).toBe(
      "warning"
    );
    expect(parseSlaHours({ warning: 10, overdue: 5 })).toEqual(DEFAULT_SLA_HOURS);
    expect(parseSlaHours(null)).toEqual(DEFAULT_SLA_HOURS);
  });
});

describe("applyLeadUpdateRules", () => {
  const now = new Date(NOW);
  const base = { id: LEAD, status: "new", first_responded_at: null, unqualified_reason: null, converted_at: null };

  it("stamps first_responded_at on the first move out of new", () => {
    const r = applyLeadUpdateRules(base, { status: "working" }, now);
    expect(r).toEqual({ patch: { status: "working", first_responded_at: now.toISOString() } });
  });

  it("keeps an existing first_responded_at and ignores non-status patches", () => {
    const responded = { ...base, first_responded_at: hoursAgo(5) };
    expect(applyLeadUpdateRules(responded, { status: "working" }, now)).toEqual({ patch: { status: "working" } });
    expect(applyLeadUpdateRules(base, { company: "Acme" }, now)).toEqual({ patch: { company: "Acme" } });
    expect(applyLeadUpdateRules(base, { status: "new" }, now)).toEqual({ patch: { status: "new" } });
  });

  it("requires a reason for unqualified", () => {
    expect(applyLeadUpdateRules(base, { status: "unqualified" }, now)).toEqual({ error: LEAD_RULE_ERRORS.reasonRequired });
    expect(applyLeadUpdateRules(base, { status: "unqualified", unqualified_reason: "  " }, now)).toEqual({
      error: LEAD_RULE_ERRORS.reasonRequired,
    });
    const ok = applyLeadUpdateRules(base, { status: "unqualified", unqualified_reason: "No budget" }, now);
    expect(ok).toEqual({
      patch: { status: "unqualified", unqualified_reason: "No budget", first_responded_at: now.toISOString() },
    });
    const unq = { ...base, status: "unqualified", unqualified_reason: "No budget", first_responded_at: hoursAgo(1) };
    expect(applyLeadUpdateRules(unq, { unqualified_reason: null }, now)).toEqual({ error: LEAD_RULE_ERRORS.reasonRequired });
  });

  it("clears the reason when leaving unqualified", () => {
    const unq = { ...base, status: "unqualified", unqualified_reason: "No budget", first_responded_at: hoursAgo(1) };
    expect(applyLeadUpdateRules(unq, { status: "working" }, now)).toEqual({
      patch: { status: "working", unqualified_reason: null },
    });
  });

  it("returns stable rule codes", () => {
    expect(isRuleCode(LEAD_RULE_ERRORS.converted)).toBe(true);
    expect(isRuleCode(LEAD_RULE_ERRORS.reasonRequired)).toBe(true);
  });

  it("makes converted leads read-only", () => {
    const converted = { ...base, status: "qualified", converted_at: hoursAgo(1) };
    expect(applyLeadUpdateRules(converted, { company: "X" }, now)).toEqual({ error: LEAD_RULE_ERRORS.converted });
  });

  it("is wired into the lead config", () => {
    expect(leadConfig.beforeUpdate?.(base, { status: "working" }, now)).toEqual({
      patch: { status: "working", first_responded_at: now.toISOString() },
    });
  });
});

describe("lead config", () => {
  it("never accepts converted_* or first_responded_at from clients", () => {
    const parsed = buildSchema(leadConfig, "update").parse({
      company: "Acme",
      status: "working",
      first_responded_at: "2026-01-01T00:00:00Z",
      converted_at: "2026-01-01T00:00:00Z",
      converted_account_id: ACCOUNT,
      sla: "overdue",
    });
    // status is edited only through the path (POST /api/crm/leads/:id/status).
    expect(parsed).toEqual({ company: "Acme" });
    expect(buildSchema(leadConfig, "create").parse({ last_name: "Doe", status: "new", priority: "normal" })).toMatchObject({ status: "new" });
  });

  it("validates the status route body", () => {
    expect(leadStatusPatch(leadStatusSchema.parse({ status: "working" }))).toEqual({ status: "working" });
    expect(leadStatusPatch(leadStatusSchema.parse({ status: "unqualified", unqualifiedReason: " No budget " }))).toEqual({
      status: "unqualified",
      unqualified_reason: "No budget",
    });
    expect(leadStatusSchema.safeParse({ status: "converted" }).success).toBe(false);
  });

  it("is read-only once converted", () => {
    const can = () => true;
    const open = recordAccess(leadConfig, { id: LEAD, converted_at: null }, can);
    expect(open).toMatchObject({ readOnly: false, canEdit: true });
    expect(open.actions.map((a) => a.kind)).toEqual(["changeOwner", "delete"]);
    const converted = recordAccess(leadConfig, { id: LEAD, converted_at: "2026-11-01T00:00:00Z" }, can);
    expect(converted).toEqual({ readOnly: true, canEdit: false, actions: [] });
    expect(recordAccess(leadConfig, { id: LEAD }, () => false)).toEqual({ readOnly: false, canEdit: false, actions: [] });
  });

  it("parses a created range filter", () => {
    const q = parseListQuery(leadConfig, new URLSearchParams("created_at=2026-11-01..2026-11-15&status=new,working"));
    expect(q.filters).toEqual({ created_at: ["2026-11-01..2026-11-15"], status: ["new", "working"] });
    expect(parseListQuery(leadConfig, new URLSearchParams("created_at=2026-11-15..2026-11-01")).filters).toEqual({});
  });
});

describe("convert payload", () => {
  it("maps a new account without an opportunity", () => {
    const payload = convertLeadSchema.parse({ account: { mode: "new" } });
    expect(toConvertRpcArgs(LEAD, payload)).toEqual({
      p_lead_id: LEAD,
      p_account_id: null,
      p_create_opportunity: false,
      p_opportunity_name: null,
      p_amount: null,
      p_currency: null,
      p_close_date: null,
    });
    expect(toConvertRpcArgs(LEAD, convertLeadSchema.parse({ account: { mode: "new" }, opportunity: null }))
      .p_create_opportunity).toBe(false);
  });

  it("maps an existing account with an opportunity", () => {
    const payload = convertLeadSchema.parse({
      account: { mode: "existing", accountId: ACCOUNT },
      opportunity: { name: " Acme – 2026-11-16 ", amount: "1234,567", currency: "EUR", closeDate: "2027-02-14" },
    });
    expect(toConvertRpcArgs(LEAD, payload)).toEqual({
      p_lead_id: LEAD,
      p_account_id: ACCOUNT,
      p_create_opportunity: true,
      p_opportunity_name: "Acme – 2026-11-16",
      p_amount: 1234.57,
      p_currency: "EUR",
      p_close_date: "2027-02-14",
    });
  });

  it("rejects invalid payloads", () => {
    expect(convertLeadSchema.safeParse({ account: { mode: "existing" } }).success).toBe(false);
    expect(convertLeadSchema.safeParse({ account: { mode: "existing", accountId: "x" } }).success).toBe(false);
    expect(convertLeadSchema.safeParse({ account: { mode: "new", accountId: ACCOUNT } }).success).toBe(false);
    expect(convertLeadSchema.safeParse({ account: { mode: "new" }, opportunity: { name: "" } }).success).toBe(false);
    expect(
      convertLeadSchema.safeParse({ account: { mode: "new" }, opportunity: { name: "A", currency: "GBP" } }).success
    ).toBe(false);
    expect(convertLeadSchema.safeParse({ account: { mode: "new" }, opportunity: { name: "A", amount: -1 } }).success).toBe(
      false
    );
    expect(convertLeadSchema.safeParse({ account: { mode: "new" }, extra: 1 }).success).toBe(false);
    expect(convertLeadSchema.safeParse(null).success).toBe(false);
  });

  it("parses the RPC result and picks the target", () => {
    const result = parseConvertResult({
      lead_id: LEAD,
      account_id: ACCOUNT,
      account_created: true,
      contact_id: LEAD.replace(/1$/, "3"),
      contact_created: true,
      opportunity_id: null,
    });
    expect(result?.accountCreated).toBe(true);
    expect(convertTarget(result!)).toBe(`/accounts/${ACCOUNT}`);
    expect(convertTarget({ accountId: ACCOUNT, opportunityId: LEAD })).toBe(`/opportunities/${LEAD}`);
    expect(parseConvertResult({ lead_id: "x" })).toBeNull();
  });

  it("builds the default opportunity name", () => {
    const date = new Date("2026-11-16T10:00:00Z");
    expect(defaultOpportunityName("Acme", "Ana", date)).toBe("Acme – 2026-11-16");
    expect(defaultOpportunityName("  ", "Ana Lima", date)).toBe("Ana Lima – 2026-11-16");
  });
});

describe("mapConvertError", () => {
  it("maps RPC errors to safe codes", () => {
    expect(mapConvertError({ code: "23505", message: "lead_already_converted" })).toEqual({
      status: 409,
      body: { error: "Lead already converted", code: "already_converted" },
    });
    expect(mapConvertError({ code: "P0002", message: "account_not_found" }).body.code).toBe("account_not_found");
    expect(mapConvertError({ code: "P0002", message: "lead_not_found" })).toMatchObject({ status: 404, body: { code: "not_found" } });
    expect(mapConvertError({ code: "P0002", message: "no_open_stage" })).toMatchObject({ status: 422, body: { code: "no_open_stage" } });
    expect(mapConvertError({ code: "42501", message: "Not allowed to create accounts" })).toMatchObject({
      status: 403,
      body: { code: "forbidden" },
    });
    expect(mapConvertError({ code: "23514", message: 'violates check constraint "x"' })).toMatchObject({
      status: 422,
      body: { code: "rule" },
    });
    const unknown = mapConvertError({ code: "XX000", message: "secret internals" });
    expect(unknown).toEqual({ status: 500, body: { error: "Request failed", code: "unavailable" } });
  });
});
