/**
 * Publish rule, TS mirror of `crm_can_publish` (supabase/migrations/20261127000000_crm_reports.sql).
 * Client-safe. The database decides; this only shapes the UI and early API errors.
 *   private: everyone; team: admin or that team's manager;
 *   public: admin or a user who manages at least one team.
 */
import type { ReportVisibility } from "./definition";

export type PublishActor = {
  /** role === "super_admin". */
  isAdmin: boolean;
  /** Ids of the teams the user manages (crm_teams.manager_id). */
  managedTeamIds: readonly string[];
};

export function canPublish(
  actor: PublishActor,
  visibility: ReportVisibility,
  teamId?: string | null
): boolean {
  switch (visibility) {
    case "private":
      return true;
    case "team":
      return !!teamId && (actor.isAdmin || actor.managedTeamIds.includes(teamId));
    case "public":
      return actor.isAdmin || actor.managedTeamIds.length > 0;
    default:
      return false;
  }
}

/** Teams the actor may publish to, out of `allTeamIds`. */
export function publishableTeamIds(actor: PublishActor, allTeamIds: readonly string[]): string[] {
  return allTeamIds.filter((id) => canPublish(actor, "team", id));
}
