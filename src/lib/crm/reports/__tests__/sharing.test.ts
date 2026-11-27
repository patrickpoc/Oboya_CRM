import { describe, expect, it } from "vitest";
import { canPublish, publishableTeamIds } from "../sharing";
import { resolveHomeLayout, type HomeLayoutRow } from "../home-layout";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const rep = { isAdmin: false, managedTeamIds: [] };
const managerA = { isAdmin: false, managedTeamIds: [A] };
const admin = { isAdmin: true, managedTeamIds: [] };

describe("canPublish", () => {
  it("private is open to everyone", () => {
    for (const actor of [rep, managerA, admin]) expect(canPublish(actor, "private")).toBe(true);
  });
  it("team: admin or that team's manager only", () => {
    expect(canPublish(rep, "team", A)).toBe(false);
    expect(canPublish(managerA, "team", A)).toBe(true);
    expect(canPublish(managerA, "team", B)).toBe(false);
    expect(canPublish(managerA, "team", null)).toBe(false);
    expect(canPublish(admin, "team", B)).toBe(true);
    expect(canPublish(admin, "team")).toBe(false);
  });
  it("public: admin or any team manager", () => {
    expect(canPublish(rep, "public")).toBe(false);
    expect(canPublish(managerA, "public")).toBe(true);
    expect(canPublish(admin, "public")).toBe(true);
  });
  it("lists publishable teams", () => {
    expect(publishableTeamIds(managerA, [A, B])).toEqual([A]);
    expect(publishableTeamIds(admin, [A, B])).toEqual([A, B]);
    expect(publishableTeamIds(rep, [A, B])).toEqual([]);
  });
});

const w = (ref: string) => [{ id: ref, kind: "builtin" as const, ref, size: "sm" as const, position: 0 }];
const row = (scope: HomeLayoutRow["scope"], extra: Partial<HomeLayoutRow>): HomeLayoutRow => ({
  scope,
  team_id: null,
  user_id: null,
  widgets: w(scope),
  ...extra,
});
const viewer = { id: "u1", teamId: A };

describe("resolveHomeLayout", () => {
  const def = row("default", {});
  const team = row("team", { team_id: A });
  const mine = row("user", { user_id: "u1" });

  it("prefers user, then team, then default", () => {
    expect(resolveHomeLayout([def, team, mine], viewer).source).toBe("user");
    expect(resolveHomeLayout([def, team], viewer).source).toBe("team");
    expect(resolveHomeLayout([def], viewer).source).toBe("default");
    expect(resolveHomeLayout([], viewer)).toEqual({ source: null, widgets: null });
  });
  it("ignores other users' and other teams' layouts (admins read them all)", () => {
    const rows = [def, row("team", { team_id: B }), row("user", { user_id: "u2" })];
    expect(resolveHomeLayout(rows, viewer).source).toBe("default");
    expect(resolveHomeLayout(rows, { id: "u1", teamId: null }).source).toBe("default");
  });
});
