import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { caseConfig, CASE_QUEUES, CASE_TYPES, CASE_STATUS_OPTIONS } from "../../objects/case";
import { registeredObjects } from "../../objects/registry";
import { OBJECT_META } from "../../objects/types";
import {
  caseReport,
  formatResolution,
} from "../report";
import {
  caseSlaState,
  caseResolutionMinutes,
  parseCaseSlaHours,
  DEFAULT_CASE_SLA_HOURS,
  type SlaCase,
} from "../sla";

const NOW = new Date("2026-11-18T12:00:00.000Z").getTime();
const hours = DEFAULT_CASE_SLA_HOURS;
const open: SlaCase = {
  status: "working",
  priority: "high",
  created_at: "2026-11-18T00:00:00.000Z",
  sla_due_at: "2026-11-19T00:00:00.000Z",
};

describe("case SLA", () => {
  it("uses per-priority hours and ignores invalid overrides", () => {
    expect(parseCaseSlaHours(null)).toEqual(hours);
    expect(parseCaseSlaHours({ urgent: 4, high: -1, low: "nope" })).toEqual({ ...hours, urgent: 4 });
  });

  it("moves from on_track to warning to overdue as the window elapses", () => {
    expect(caseSlaState(open, NOW, hours)).toBe("on_track");
    expect(caseSlaState(open, new Date("2026-11-18T19:00:00.000Z").getTime(), hours)).toBe("warning");
    expect(caseSlaState(open, new Date("2026-11-19T01:00:00.000Z").getTime(), hours)).toBe("overdue");
  });

  it("reports met or missed after resolution and nothing for closed-without-clock", () => {
    const base = { ...open, status: "resolved" };
    expect(caseSlaState({ ...base, resolved_at: "2026-11-18T20:00:00.000Z" }, NOW, hours)).toBe("met");
    expect(caseSlaState({ ...base, resolved_at: "2026-11-19T04:00:00.000Z" }, NOW, hours)).toBe("missed");
    expect(caseSlaState({ ...base, priority: undefined, created_at: undefined }, NOW, hours)).toBeNull();
  });

  it("computes whole resolution minutes from creation to resolution", () => {
    expect(caseResolutionMinutes({ ...open, status: "resolved", resolved_at: "2026-11-18T02:30:00.000Z" })).toBe(150);
    expect(caseResolutionMinutes(open)).toBeNull();
  });
});

describe("case reporting", () => {
  it("summarises open/resolved, breaches and average resolution", () => {
    const rows = [
      { id: "1", ...open },
      {
        id: "2",
        status: "resolved",
        priority: "normal",
        created_at: "2026-11-18T00:00:00.000Z",
        sla_due_at: "2026-11-20T00:00:00.000Z",
        resolved_at: "2026-11-18T01:00:00.000Z",
      },
      {
        id: "3",
        status: "working",
        priority: "urgent",
        created_at: "2026-11-17T00:00:00.000Z",
        sla_due_at: "2026-11-17T08:00:00.000Z",
      },
    ];
    const report = caseReport(rows, NOW, hours);
    expect(report.total).toBe(3);
    expect(report.open).toBe(2);
    expect(report.resolved).toBe(1);
    expect(report.breached).toBe(1);
    expect(report.avgResolutionMinutes).toBe(60);
    expect(report.byState.overdue).toBe(1);
    expect(report.byState.met).toBe(1);
  });

  it("formats resolution durations", () => {
    expect(formatResolution(null)).toBe("—");
    expect(formatResolution(45)).toBe("45m");
    expect(formatResolution(120)).toBe("2.0h");
    expect(formatResolution(2880)).toBe("2d");
  });
});

describe("case object config", () => {
  it("registers the case object with lookups, SLA and resolution fields", () => {
    expect(registeredObjects()).toContain("case");
    expect(OBJECT_META.case).toMatchObject({ table: "crm_cases", module: "cases", basePath: "/cases" });
    const keys = caseConfig.fields.map((field) => field.key);
    for (const key of ["account_id", "contact_id", "priority", "type", "queue", "sla", "resolution_notes", "resolution_minutes"]) {
      expect(keys).toContain(key);
    }
    expect(caseConfig.fields.find((field) => field.key === "sla")?.virtual).toBe(true);
    expect(caseConfig.relatedLists[0]).toMatchObject({ object: "activity", where: { what_object: "case" } });
  });

  it("declares bounded status, priority, type and queue values", () => {
    expect(CASE_STATUS_OPTIONS.map((option) => option.value)).toEqual(["new", "working", "resolved", "closed"]);
    expect(CASE_TYPES).toHaveLength(4);
    expect(CASE_QUEUES).toHaveLength(5);
    expect(caseConfig.path).toEqual({ field: "status", source: "static" });
  });
});

describe("cases migration hardening", () => {
  const sql = fs.readFileSync(
    path.resolve(__dirname, "../../../../../supabase/migrations/20261118000000_crm_cases.sql"),
    "utf8"
  );

  it("uses RLS, short triggers and bounded aggregate reporting", () => {
    expect(sql).toContain("alter table public.crm_cases enable row level security");
    expect(sql).toContain("crm_can_see_record('account', account_id)");
    expect(sql).toContain("create or replace function public.crm_case_rules()");
    expect(sql).toContain("create or replace function public.crm_case_report()");
    expect(sql).toContain("security invoker");
    expect(sql).toContain("crm_cases_open_sla_idx");
    expect(sql.toLowerCase()).not.toContain("offset ");
  });
});
