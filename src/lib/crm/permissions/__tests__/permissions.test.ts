import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CrmModule, PermissionOverrides } from "@/lib/crm/types";
import { CRM_MODULES } from "@/lib/crm/types";
import { BUILTIN_MATRIX } from "../defaults";
import {
  hydrateAccessMatrix,
  parseAccessMatrix,
  resetAccessMatrixToBuiltin,
} from "../access-store";
import { canAccess, canAccessUser, resolvePermissions } from "../access-resolve";
import { canAccessUserClient, getPermissions } from "../matrix";

const OBJECTS: CrmModule[] = ["leads", "accounts", "contacts", "opportunities", "activities"];
const SETUP = CRM_MODULES.filter((m) => m.startsWith("setup_"));
const ALL = ["view", "create", "edit", "delete", "convert", "export"];

const user = (role: string, permissionOverrides: PermissionOverrides = {}) => ({
  role,
  permissionOverrides,
});

afterEach(() => {
  resetAccessMatrixToBuiltin();
  vi.unstubAllGlobals();
});

/** Server-style call: the matrix is explicit (builtin unless given). */
const can = (
  u: Parameters<typeof canAccessUser>[0],
  m: CrmModule,
  a: Parameters<typeof canAccessUser>[2] = "view",
  mx = BUILTIN_MATRIX
) => canAccessUser(u, m, a, mx);

describe("BUILTIN_MATRIX (mirrors the SQL seed)", () => {
  it("equals the crm_access_control seed in the latest migration", () => {
    const sql = readFileSync(
      path.resolve(__dirname, "../../../../../supabase/migrations/20261117010000_crm_email.sql"),
      "utf8"
    );
    const seed = sql.match(/\$json\$([\s\S]*?)\$json\$/);
    expect(seed).not.toBeNull();
    expect(parseAccessMatrix(JSON.parse(seed![1]))).toEqual(BUILTIN_MATRIX);
  });

  it("super_admin is full everywhere", () => {
    for (const m of CRM_MODULES) expect(BUILTIN_MATRIX.super_admin[m]).toBe("full");
  });

  it("sales_manager: full on home + objects, view on audit_logs, none on setup", () => {
    for (const m of ["home", ...OBJECTS] as CrmModule[]) {
      expect(BUILTIN_MATRIX.sales_manager[m]).toBe("full");
    }
    expect(BUILTIN_MATRIX.sales_manager.audit_logs).toEqual(["view"]);
    for (const m of SETUP) expect(BUILTIN_MATRIX.sales_manager[m]).toBe("none");
  });

  it("sales_rep rows", () => {
    const r = BUILTIN_MATRIX.sales_rep;
    expect(r.leads).toEqual(["view", "create", "edit", "convert", "export"]);
    for (const m of ["accounts", "contacts", "opportunities"] as CrmModule[]) {
      expect(r[m]).toEqual(["view", "create", "edit", "export"]);
    }
    expect(r.activities).toEqual(["view", "create", "edit", "delete"]);
    expect(r.home).toEqual(["view"]);
    for (const m of [...SETUP, "audit_logs"] as CrmModule[]) expect(r[m]).toBe("none");
  });

  it("read_only: view + export on objects, view on home, none elsewhere", () => {
    const r = BUILTIN_MATRIX.read_only;
    for (const m of OBJECTS) expect(r[m]).toEqual(["view", "export"]);
    expect(r.home).toEqual(["view"]);
    for (const m of [...SETUP, "audit_logs"] as CrmModule[]) expect(r[m]).toBe("none");
  });
});

describe("canAccessUser", () => {
  it("resolves role permissions from the builtin matrix", () => {
    expect(can(user("sales_rep"), "leads", "convert")).toBe(true);
    expect(can(user("sales_rep"), "leads", "delete")).toBe(false);
    expect(can(user("sales_rep"), "setup_users", "view")).toBe(false);
    expect(can(user("read_only"), "accounts", "export")).toBe(true);
    expect(can(user("read_only"), "accounts", "edit")).toBe(false);
    expect(can(user("sales_manager"), "opportunities", "delete")).toBe(true);
  });

  it("defaults the action to view", () => {
    expect(can(user("read_only"), "home")).toBe(true);
  });

  it("accepts full/none levels in overrides, like crm_has_permission", () => {
    const rep = user("sales_rep", {
      grants: { setup_users: "full" },
      denies: { leads: "full", accounts: "none" },
    });
    expect(can(rep, "setup_users", "delete")).toBe(true);
    expect(can(rep, "leads", "view")).toBe(false);
    expect(can(rep, "accounts", "edit")).toBe(true);
  });

  it("applies grants and denies (role ∪ grants − denies)", () => {
    const rep = user("sales_rep", {
      grants: { setup_picklists: ["view"], leads: ["delete"] },
      denies: { leads: ["export"] },
    });
    expect(can(rep, "setup_picklists", "view")).toBe(true);
    expect(can(rep, "leads", "delete")).toBe(true);
    expect(can(rep, "leads", "export")).toBe(false);
    expect(can(rep, "leads", "view")).toBe(true);
  });

  it("deny wins over a grant of the same action", () => {
    const rep = user("sales_rep", { grants: { leads: ["delete"] }, denies: { leads: ["delete"] } });
    expect(can(rep, "leads", "delete")).toBe(false);
  });

  it("super_admin bypasses the matrix and denies", () => {
    const admin = user("super_admin", { denies: { setup_access: ["view", "edit"] } });
    expect(can(admin, "setup_access", "edit")).toBe(true);
    const matrix = parseAccessMatrix({ super_admin: { leads: "none" } });
    expect(can(admin, "leads", "delete", matrix)).toBe(true);
  });

  it("denies unknown roles, null users and junk overrides", () => {
    expect(can(user("ghost"), "home", "view")).toBe(false);
    expect(can(null, "home", "view")).toBe(false);
    const junk = user("ghost", {
      grants: { leads: ["fly" as never] },
    });
    expect(can(junk, "leads", "view")).toBe(false);
    expect(canAccess("ghost", "home", "view", BUILTIN_MATRIX)).toBe(false);
  });

  it("grants work for an unknown custom role", () => {
    expect(can(user("custom", { grants: { home: ["view"] } }), "home")).toBe(true);
  });
});

describe("matrix loaded from crm_access_control", () => {
  it("no singleton row means builtin; a stored matrix is taken as is", () => {
    expect(parseAccessMatrix(null)).toEqual(BUILTIN_MATRIX);
    const empty = parseAccessMatrix({});
    expect(can(user("sales_rep"), "home", "view", empty)).toBe(false);
    expect(can(user("super_admin"), "home", "view", empty)).toBe(true);
  });

  it("stored rows replace builtin, and custom roles resolve", () => {
    const matrix = parseAccessMatrix({
      sales_rep: { leads: ["view"], home: "full" },
      partner: { leads: ["view", "nope"] },
    });
    expect(can(user("sales_rep"), "leads", "create", matrix)).toBe(false);
    expect(can(user("sales_rep"), "home", "export", matrix)).toBe(true);
    // Modules missing from a stored row are none.
    expect(can(user("sales_rep"), "accounts", "view", matrix)).toBe(false);
    // Roles without a stored row have no permissions (same as SQL).
    expect(can(user("read_only"), "contacts", "view", matrix)).toBe(false);
    // Client snapshot: hydration is browser-only.
    expect(() => hydrateAccessMatrix(matrix)).toThrow();
    vi.stubGlobal("window", {});
    hydrateAccessMatrix(matrix);
    expect(getPermissions("partner", "leads")).toEqual(["view"]);
    expect(canAccessUserClient(user("sales_rep"), "leads", "create")).toBe(false);
  });

  it("a malformed row denies that role; a malformed doc throws", () => {
    const matrix = parseAccessMatrix({ sales_manager: "full" });
    expect(can(user("sales_manager"), "leads", "view", matrix)).toBe(false);
    expect(() => parseAccessMatrix("x")).toThrow();
    expect(() => parseAccessMatrix(["x"])).toThrow();
  });

  it("resolvePermissions lists every module", () => {
    const perms = resolvePermissions(user("super_admin"), BUILTIN_MATRIX);
    expect(Object.keys(perms).sort()).toEqual([...CRM_MODULES].sort());
    expect(perms.setup_roles).toEqual(ALL);
    expect(resolvePermissions(user("read_only"), BUILTIN_MATRIX).setup_users).toEqual([]);
  });
});
