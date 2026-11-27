import "server-only";

import type { CrmSupabaseClient } from "@/lib/supabase/server";
import type { CrmUser } from "@/lib/crm/types";
import type {
  DashboardDto,
  FolderDto,
  ReportDto,
  ReportListQuery,
  ReportSummary,
} from "./api-contract";
import {
  DashboardWidgetSchema,
  HomeWidgetSchema,
  ReportDefinitionSchema,
  type DashboardInput,
  type DashboardWidget,
  type FolderInput,
  type HomeLayoutScope,
  type HomeWidget,
  type ReportDefinition,
  type ReportInput,
  type ReportObject,
  type ReportVisibility,
} from "./definition";
import { resolveHomeLayout, type HomeLayoutRow, type ResolvedHomeLayout } from "./home-layout";
import { ReportDefinitionError } from "./engine";
import type { PublishActor } from "./sharing";

/**
 * User-scoped CRUD for folders, reports, dashboards and home layouts. RLS is the
 * authority (private/team/public reads, publish rule, soft delete); a Postgres
 * error is thrown as is for `dbErrorResponse`, a missing/invisible row is `null`.
 * Lists and lookups always add `deleted_at is null`.
 */
export type Viewer = Pick<CrmUser, "id" | "teamId" | "role">;

const isAdmin = (v: Viewer) => v.role === "super_admin";
const OWNER = "owner:crm_users!owner_id(full_name, email)";
const AUDIT = `owner_id, created_at, updated_at, ${OWNER}`;

type OwnerEmbed = { full_name: string | null; email: string | null } | null;
type AuditRow = { owner_id: string; created_at: string; updated_at: string; owner: OwnerEmbed };

function audit(row: AuditRow) {
  return {
    ownerId: row.owner_id,
    ownerName: row.owner?.full_name?.trim() || row.owner?.email || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
const canEditRow = (v: Viewer, row: { owner_id: string }) => isAdmin(v) || row.owner_id === v.id;

function ok<T>(res: { data: T; error: unknown }): T {
  if (res.error) throw res.error;
  return res.data;
}

/** Teams the viewer manages (feeds `canPublish`). */
export async function publishActor(client: CrmSupabaseClient, viewer: Viewer): Promise<PublishActor> {
  const rows = ok(await client.from("crm_teams").select("id").eq("manager_id", viewer.id).eq("active", true)) ?? [];
  return { isAdmin: isAdmin(viewer), managedTeamIds: rows.map((r: { id: string }) => r.id) };
}

// ------------------------------------------------------------------ folders

const FOLDER = `id, name, visibility, team_id, ${AUDIT}`;
type FolderRow = AuditRow & { id: string; name: string; visibility: ReportVisibility; team_id: string | null };
const toFolder = (v: Viewer, r: FolderRow): FolderDto => ({
  id: r.id,
  name: r.name,
  visibility: r.visibility,
  teamId: r.team_id,
  canEdit: canEditRow(v, r),
  ...audit(r),
});

export async function listFolders(client: CrmSupabaseClient, v: Viewer): Promise<FolderDto[]> {
  const rows = ok(
    await client.from("crm_report_folders").select(FOLDER).is("deleted_at", null).order("name")
  ) as unknown as FolderRow[];
  return rows.map((r) => toFolder(v, r));
}

export async function createFolder(client: CrmSupabaseClient, v: Viewer, input: FolderInput) {
  const row = ok(
    await client
      .from("crm_report_folders")
      .insert({
        name: input.name,
        visibility: input.visibility,
        team_id: input.visibility === "team" ? input.teamId : null,
      })
      .select(FOLDER)
      .single()
  ) as unknown as FolderRow;
  return toFolder(v, row);
}

export async function updateFolder(
  client: CrmSupabaseClient,
  v: Viewer,
  id: string,
  patch: Partial<FolderInput>
) {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.visibility !== undefined) {
    update.visibility = patch.visibility;
    update.team_id = patch.visibility === "team" ? (patch.teamId ?? null) : null;
  } else if (patch.teamId !== undefined) update.team_id = patch.teamId;
  const row = ok(
    await client
      .from("crm_report_folders")
      .update(update)
      .eq("id", id)
      .is("deleted_at", null)
      .select(FOLDER)
      .maybeSingle()
  ) as unknown as FolderRow | null;
  return row ? toFolder(v, row) : null;
}

/** Soft delete. Reports in the folder fall back to private (folder_id stays, the folder is hidden). */
export async function deleteFolder(client: CrmSupabaseClient, id: string): Promise<boolean> {
  const rows = ok(
    await client
      .from("crm_report_folders")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null)
      .select("id")
  ) as { id: string }[];
  return rows.length > 0;
}

// ------------------------------------------------------------------ reports

const FOLDER_EMBED = "folder:crm_report_folders(visibility, deleted_at)";
const REPORT = `id, name, description, object, folder_id, schema_version, ${AUDIT}, ${FOLDER_EMBED}`;
type ReportRow = AuditRow & {
  id: string;
  name: string;
  description: string;
  object: ReportObject;
  folder_id: string | null;
  schema_version: number;
  definition?: ReportDefinition;
  folder: { visibility: ReportVisibility; deleted_at: string | null } | null;
};
const toSummary = (v: Viewer, r: ReportRow): ReportSummary => ({
  id: r.id,
  name: r.name,
  description: r.description,
  object: r.object,
  folderId: r.folder_id,
  visibility: r.folder && !r.folder.deleted_at ? r.folder.visibility : "private",
  canEdit: canEditRow(v, r),
  ...audit(r),
});
/** Stored JSON is re-validated on read; an invalid definition throws ReportDefinitionError (routes: 422). */
const toReport = (v: Viewer, r: ReportRow): ReportDto => {
  const parsed = ReportDefinitionSchema.safeParse(r.definition);
  if (!parsed.success) {
    throw new ReportDefinitionError(
      parsed.error.issues.map((i) => ({ path: i.path.join("."), code: i.code }))
    );
  }
  return {
    ...toSummary(v, r),
    object: parsed.data.object,
    definition: parsed.data,
    schemaVersion: r.schema_version,
  };
};

const likeEscape = (s: string) => s.replace(/[\\%_,()]/g, " ").trim();

export async function listReports(
  client: CrmSupabaseClient,
  v: Viewer,
  query: ReportListQuery
): Promise<ReportSummary[]> {
  let q = client.from("crm_reports").select(REPORT).is("deleted_at", null);
  if (query.folderId) q = q.eq("folder_id", query.folderId);
  if (query.object) q = q.eq("object", query.object);
  const term = query.q ? likeEscape(query.q) : "";
  if (term) q = q.ilike("name", `%${term}%`);
  const rows = ok(await q.order("updated_at", { ascending: false }).limit(500)) as unknown as ReportRow[];
  return rows.map((r) => toSummary(v, r));
}

export async function getReport(client: CrmSupabaseClient, v: Viewer, id: string) {
  const row = ok(
    await client
      .from("crm_reports")
      .select(`${REPORT}, definition`)
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle()
  ) as unknown as ReportRow | null;
  return row ? toReport(v, row) : null;
}

export async function createReport(client: CrmSupabaseClient, v: Viewer, input: ReportInput) {
  const inserted = ok(
    await client
      .from("crm_reports")
      .insert({
        name: input.name,
        description: input.description,
        folder_id: input.folderId ?? null,
        object: input.definition.object,
        definition: input.definition,
        schema_version: input.definition.version,
      })
      .select("id")
      .single()
  ) as { id: string };
  return getReport(client, v, inserted.id);
}

export async function updateReport(
  client: CrmSupabaseClient,
  v: Viewer,
  id: string,
  patch: Partial<ReportInput>
) {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.folderId !== undefined) update.folder_id = patch.folderId;
  if (patch.definition !== undefined) {
    update.definition = patch.definition;
    update.object = patch.definition.object;
    update.schema_version = patch.definition.version;
  }
  const rows = ok(
    await client.from("crm_reports").update(update).eq("id", id).is("deleted_at", null).select("id")
  ) as { id: string }[];
  return rows.length ? getReport(client, v, id) : null;
}

export async function deleteReport(client: CrmSupabaseClient, id: string): Promise<boolean> {
  const rows = ok(
    await client
      .from("crm_reports")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null)
      .select("id")
  ) as { id: string }[];
  return rows.length > 0;
}

// --------------------------------------------------------------- dashboards

const DASHBOARD = `id, name, description, visibility, team_id, ${AUDIT}`;
type DashboardRow = AuditRow & {
  id: string;
  name: string;
  description: string;
  visibility: ReportVisibility;
  team_id: string | null;
  widgets?: DashboardWidget[];
};
const toDashboardSummary = (v: Viewer, r: DashboardRow): Omit<DashboardDto, "widgets"> => ({
  id: r.id,
  name: r.name,
  description: r.description,
  visibility: r.visibility,
  teamId: r.team_id,
  canEdit: canEditRow(v, r),
  ...audit(r),
});

export async function listDashboards(client: CrmSupabaseClient, v: Viewer) {
  const rows = ok(
    await client.from("crm_dashboards").select(DASHBOARD).is("deleted_at", null).order("name")
  ) as unknown as DashboardRow[];
  return rows.map((r) => toDashboardSummary(v, r));
}

/** Invalid stored widgets are skipped, never rendered. */
function validWidgets(raw: unknown): DashboardWidget[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((w) => {
    const p = DashboardWidgetSchema.safeParse(w);
    return p.success ? [p.data] : [];
  });
}

export async function getDashboard(
  client: CrmSupabaseClient,
  v: Viewer,
  id: string
): Promise<DashboardDto | null> {
  const row = ok(
    await client
      .from("crm_dashboards")
      .select(`${DASHBOARD}, widgets`)
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle()
  ) as unknown as DashboardRow | null;
  return row ? { ...toDashboardSummary(v, row), widgets: validWidgets(row.widgets) } : null;
}

export async function createDashboard(client: CrmSupabaseClient, v: Viewer, input: DashboardInput) {
  const inserted = ok(
    await client
      .from("crm_dashboards")
      .insert({
        name: input.name,
        description: input.description,
        visibility: input.visibility,
        team_id: input.visibility === "team" ? input.teamId : null,
        widgets: input.widgets,
      })
      .select("id")
      .single()
  ) as { id: string };
  return getDashboard(client, v, inserted.id);
}

export async function updateDashboard(
  client: CrmSupabaseClient,
  v: Viewer,
  id: string,
  patch: Partial<DashboardInput>
) {
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.widgets !== undefined) update.widgets = patch.widgets;
  if (patch.visibility !== undefined) {
    update.visibility = patch.visibility;
    update.team_id = patch.visibility === "team" ? (patch.teamId ?? null) : null;
  } else if (patch.teamId !== undefined) update.team_id = patch.teamId;
  const rows = ok(
    await client.from("crm_dashboards").update(update).eq("id", id).is("deleted_at", null).select("id")
  ) as { id: string }[];
  return rows.length ? getDashboard(client, v, id) : null;
}

export async function deleteDashboard(client: CrmSupabaseClient, id: string): Promise<boolean> {
  const rows = ok(
    await client
      .from("crm_dashboards")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null)
      .select("id")
  ) as { id: string }[];
  return rows.length > 0;
}

// ------------------------------------------------------------- home layouts

const LAYOUT = "scope, team_id, user_id, widgets";

async function liveLayouts(client: CrmSupabaseClient): Promise<HomeLayoutRow[]> {
  const rows = ok(
    await client.from("crm_home_layouts").select(LAYOUT).is("deleted_at", null)
  ) as unknown as HomeLayoutRow[];
  return rows.map((r) => ({
    ...r,
    widgets: ((Array.isArray(r.widgets) ? r.widgets : []) as unknown[]).flatMap((w) => {
      const p = HomeWidgetSchema.safeParse(w);
      return p.success ? [p.data] : [];
    }),
  }));
}

/** Resolved layout: user, then team, then default (null source = built-in default). */
export async function resolveHome(client: CrmSupabaseClient, v: Viewer): Promise<ResolvedHomeLayout> {
  return resolveHomeLayout(await liveLayouts(client), v);
}

/** The layout saved at one scope (`teamId` defaults to the viewer's team). */
export async function getHomeLayout(
  client: CrmSupabaseClient,
  v: Viewer,
  scope: HomeLayoutScope,
  teamId?: string | null
): Promise<HomeWidget[] | null> {
  const target = scope === "team" ? (teamId ?? v.teamId) : null;
  const row = (await liveLayouts(client)).find((r) =>
    scope === "default"
      ? r.scope === "default"
      : scope === "team"
        ? r.scope === "team" && r.team_id === target
        : r.scope === "user" && r.user_id === v.id
  );
  return row?.widgets ?? null;
}

/** Update-or-insert the live row (a concurrent insert surfaces as 23505, mapped to 409). */
export async function saveHomeLayout(
  client: CrmSupabaseClient,
  v: Viewer,
  scope: HomeLayoutScope,
  teamId: string | null | undefined,
  widgets: HomeWidget[]
): Promise<void> {
  const target = {
    scope,
    team_id: scope === "team" ? (teamId ?? v.teamId) : null,
    user_id: scope === "user" ? v.id : null,
  };
  let q = client.from("crm_home_layouts").update({ widgets }).eq("scope", scope).is("deleted_at", null);
  if (target.team_id) q = q.eq("team_id", target.team_id);
  if (target.user_id) q = q.eq("user_id", target.user_id);
  const updated = ok(await q.select("id")) as { id: string }[];
  if (updated.length) return;
  ok(await client.from("crm_home_layouts").insert({ ...target, widgets }).select("id").single());
}

/** Reset: hard delete of the live row (the audit trigger records it). */
export async function deleteHomeLayout(
  client: CrmSupabaseClient,
  v: Viewer,
  scope: HomeLayoutScope,
  teamId?: string | null
): Promise<boolean> {
  let q = client.from("crm_home_layouts").delete().eq("scope", scope).is("deleted_at", null);
  if (scope === "team") q = q.eq("team_id", teamId ?? v.teamId ?? "");
  if (scope === "user") q = q.eq("user_id", v.id);
  return (ok(await q.select("id")) as { id: string }[]).length > 0;
}
