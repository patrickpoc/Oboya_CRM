import { describe, expect, it } from "vitest";
import { opportunityConfig } from "@/lib/crm/objects/opportunity";
import { parseDateRange, parseListQuery } from "@/lib/crm/objects/query";
import { buildSchema } from "@/lib/crm/objects/schema";
import { isOverdue, pipelineKey, pipelineParams, summarizeColumn } from "../pipeline";
import {
  isProbabilityOverridden,
  planStageChange,
  stageKindsFromRows,
  type OpportunityStageState,
  type StageInfo,
} from "../stages";

const PROSPECTING: StageInfo = { id: "s1", kind: "open", probability: 10 };
const PROPOSAL: StageInfo = { id: "s4", kind: "open", probability: 60 };
const WON: StageInfo = { id: "won", kind: "won", probability: 100 };
const LOST: StageInfo = { id: "lost", kind: "lost", probability: 0 };

const state = (patch: Partial<OpportunityStageState> = {}): OpportunityStageState => ({
  stageId: "s1",
  probability: 10,
  lossReason: null,
  lossNote: null,
  ...patch,
});

describe("planStageChange", () => {
  it("requires a loss reason for a lost stage", () => {
    expect(planStageChange(state(), PROSPECTING, LOST, { stageId: "lost" })).toEqual({
      ok: false,
      error: "loss_reason_required",
    });
    expect(planStageChange(state(), PROSPECTING, LOST, { stageId: "lost", lossReason: "  " }).ok).toBe(false);
  });

  it("sets loss fields and the lost default probability", () => {
    const plan = planStageChange(state({ probability: 35 }), PROSPECTING, LOST, {
      stageId: "lost",
      lossReason: "price",
      lossNote: " too expensive ",
    });
    expect(plan).toMatchObject({
      ok: true,
      stageChanged: true,
      patch: { stage_id: "lost", probability: 0, loss_reason: "price", loss_note: "too expensive" },
    });
  });

  it("keeps the existing reason when already lost and allows editing it", () => {
    const lost = state({ stageId: "lost", probability: 0, lossReason: "price", lossNote: "n" });
    const same = planStageChange(lost, LOST, LOST, { stageId: "lost" });
    expect(same).toMatchObject({ ok: true, changed: false });
    const edited = planStageChange(lost, LOST, LOST, { stageId: "lost", lossReason: "timing", lossNote: null });
    expect(edited).toMatchObject({ ok: true, changed: true, stageChanged: false, patch: { loss_reason: "timing", loss_note: null } });
  });

  it("clears loss fields when reopening", () => {
    const lost = state({ stageId: "lost", probability: 0, lossReason: "price", lossNote: "n" });
    const plan = planStageChange(lost, LOST, PROPOSAL, { stageId: "s4", lossReason: "price" });
    expect(plan).toMatchObject({ ok: true, patch: { loss_reason: null, loss_note: null, probability: 60 } });
  });

  it("applies the target default when probability was not overridden", () => {
    const plan = planStageChange(state(), PROSPECTING, PROPOSAL, { stageId: "s4" });
    expect(plan).toMatchObject({ ok: true, patch: { probability: 60 } });
  });

  it("keeps an overridden probability between open stages", () => {
    const overridden = state({ probability: 25 });
    expect(isProbabilityOverridden(overridden, PROSPECTING)).toBe(true);
    expect(planStageChange(overridden, PROSPECTING, PROPOSAL, { stageId: "s4" })).toMatchObject({
      ok: true,
      patch: { probability: 25 },
    });
  });

  it("closed stages always force their default; explicit probability wins", () => {
    const overridden = state({ probability: 25 });
    expect(planStageChange(overridden, PROSPECTING, WON, { stageId: "won" })).toMatchObject({
      ok: true,
      patch: { probability: 100 },
    });
    expect(planStageChange(state(), PROSPECTING, PROPOSAL, { stageId: "s4", probability: 45 })).toMatchObject({
      ok: true,
      patch: { probability: 45 },
    });
  });

  it("a probability from a closed stage is never an override", () => {
    const won = state({ stageId: "won", probability: 90 });
    expect(isProbabilityOverridden(won, WON)).toBe(false);
    expect(planStageChange(won, WON, PROPOSAL, { stageId: "s4" })).toMatchObject({ ok: true, patch: { probability: 60 } });
  });
});

describe("pipeline helpers", () => {
  it("summarizes counts, totals and weighted amounts per currency", () => {
    const summary = summarizeColumn([
      { id: "a", amount: 1000, currency: "USD", probability: 50 },
      { id: "b", amount: 500.5, currency: "USD", probability: 10 },
      { id: "c", amount: 200, currency: "BRL", probability: 100 },
      { id: "d", amount: null, currency: "EUR", probability: 20 },
    ]);
    expect(summary).toEqual({
      count: 4,
      totals: { USD: 1500.5, BRL: 200 },
      weighted: { USD: 550.05, BRL: 200 },
    });
  });

  it("flags only open opportunities past their close date", () => {
    expect(isOverdue("2026-01-01", "open", "2026-11-16")).toBe(true);
    expect(isOverdue("2026-11-16", "open", "2026-11-16")).toBe(false);
    expect(isOverdue("2026-01-01", "won", "2026-11-16")).toBe(false);
    expect(isOverdue(null, "open", "2026-11-16")).toBe(false);
  });

  it("keeps only kanban params and parses the close-date range", () => {
    expect(pipelineKey({ view: "all", q: "x", close_date: "2026-01-01..2026-03-31" })).toBe(
      "view=all&close_date=2026-01-01..2026-03-31"
    );
    const query = parseListQuery(opportunityConfig, pipelineParams({ close_date: "..2026-03-31", sort: "name" }), {
      maxPageSize: 500,
    });
    expect(query.filters.close_date).toEqual(["..2026-03-31"]);
    expect(query.sort).toBe("close_date");
    expect(query.pageSize).toBe(500);
  });

  it("validates date ranges", () => {
    expect(parseDateRange("2026-01-01..2026-02-01")).toEqual({ from: "2026-01-01", to: "2026-02-01" });
    expect(parseDateRange("2026-03-01..2026-02-01")).toBeNull();
    expect(parseDateRange("..")).toBeNull();
    expect(parseDateRange("2026-13-01..")).toBeNull();
  });
});

describe("opportunity config", () => {
  it("does not accept stage or loss fields through the generic PATCH", () => {
    const parsed = buildSchema(opportunityConfig, "update").safeParse({
      stage_id: "00000000-0000-4000-8000-000000000001",
      loss_reason: "price",
      name: "Deal",
    });
    expect(parsed.success && parsed.data).toEqual({ name: "Deal" });
  });

  it("requires account and stage on create and accepts only known currencies", () => {
    const schema = buildSchema(opportunityConfig, "create");
    const base = {
      name: "Deal",
      account_id: "00000000-0000-4000-8000-000000000001",
      stage_id: "00000000-0000-4000-8000-000000000002",
      currency: "BRL",
    };
    expect(schema.safeParse(base).success).toBe(true);
    expect(schema.safeParse({ ...base, account_id: null }).success).toBe(false);
    expect(schema.safeParse({ ...base, currency: "GBP" }).success).toBe(false);
  });

  it("filters by open/won/lost", () => {
    const query = parseListQuery(opportunityConfig, new URLSearchParams("stage_kind=open,won,bogus"));
    expect(query.filters.stage_kind).toEqual(["open", "won"]);
  });
});

describe("stageKindsFromRows", () => {
  it("maps each row's stage_id to its kind without a query", () => {
    const kinds = new Map([
      ["s-open", "open"],
      ["s-won", "won"],
    ]);
    const out = stageKindsFromRows(
      [
        { id: "a", stage_id: "s-open" },
        { id: "b", stage_id: "s-won" },
        { id: "c", stage_id: "s-unknown" },
        { id: "d" },
      ],
      kinds
    );
    expect(Object.fromEntries(out)).toEqual({ a: "open", b: "won" });
  });
});
