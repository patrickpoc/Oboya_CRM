/** Home layout resolution: user, then team, then default. Pure. */
import type { HomeLayoutScope, HomeWidget } from "./definition";

export type HomeLayoutRow = {
  scope: HomeLayoutScope;
  team_id: string | null;
  user_id: string | null;
  widgets: HomeWidget[];
};

export type ResolvedHomeLayout = { source: HomeLayoutScope | null; widgets: HomeWidget[] | null };

/** Rows may include other users' and teams' layouts (admins read them all). */
export function resolveHomeLayout(
  rows: readonly HomeLayoutRow[],
  viewer: { id: string; teamId: string | null }
): ResolvedHomeLayout {
  const mine = rows.find((r) => r.scope === "user" && r.user_id === viewer.id);
  if (mine) return { source: "user", widgets: mine.widgets };
  const team = viewer.teamId
    ? rows.find((r) => r.scope === "team" && r.team_id === viewer.teamId)
    : undefined;
  if (team) return { source: "team", widgets: team.widgets };
  const base = rows.find((r) => r.scope === "default");
  if (base) return { source: "default", widgets: base.widgets };
  return { source: null, widgets: null };
}
