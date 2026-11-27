/**
 * Route paths and request/response types of the reports and home APIs.
 * Client-safe: builders import paths and types from here. Errors use the
 * shared `jsonError` shape: `{ error, code, ...extra }`.
 */
import type {
  DashboardInput,
  DashboardWidget,
  FolderInput,
  HomeLayoutInput,
  HomeLayoutScope,
  HomeWidget,
  ReportChart,
  ReportDefinition,
  ReportInput,
  ReportObject,
  ReportResult,
  ReportVisibility,
} from "./definition";

export type ApiErrorBody = {
  error: string;
  code: string;
  fields?: Record<string, string>;
};

export const REPORTS_API = {
  folders: "/api/crm/reports/folders",
  folder: (id: string) => `/api/crm/reports/folders/${id}`,
  reports: "/api/crm/reports",
  report: (id: string) => `/api/crm/reports/${id}`,
  /** POST: preview of an unsaved definition. */
  run: "/api/crm/reports/run",
  /** GET: run a saved report. Query: RunQuery. */
  runSaved: (id: string) => `/api/crm/reports/${id}/run`,
  /** GET text/csv. Query: ExportQuery. */
  export: (id: string, mode: ExportMode = "rows") =>
    `/api/crm/reports/${id}/export?mode=${mode}`,
  dashboards: "/api/crm/reports/dashboards",
  dashboard: (id: string) => `/api/crm/reports/dashboards/${id}`,
  /** GET: widgets run at most 3 at a time. */
  dashboardData: (id: string) => `/api/crm/reports/dashboards/${id}/data`,
  /** GET (resolved, or `?scope=`), PUT `?scope=`, DELETE `?scope=user`. Module `home`. */
  homeLayout: "/api/crm/home/layout",
} as const;

type Audit = {
  ownerId: string;
  ownerName: string | null;
  createdAt: string;
  updatedAt: string;
};

// Folders: GET list, POST create, PATCH/DELETE [id] (soft delete).
export type FolderDto = Audit & {
  id: string;
  name: string;
  visibility: ReportVisibility;
  teamId: string | null;
  /** Viewer may rename/delete it. */
  canEdit: boolean;
};
export type FolderListResponse = { folders: FolderDto[] };
export type FolderCreateRequest = FolderInput;
export type FolderUpdateRequest = Partial<FolderInput>;
export type FolderResponse = { folder: FolderDto };

// Reports: GET list (`?folderId=&q=&object=`), POST create, GET/PATCH/DELETE [id].
export type ReportSummary = Audit & {
  id: string;
  name: string;
  description: string;
  object: ReportObject;
  folderId: string | null;
  /** Inherited from the folder; "private" without a folder. */
  visibility: ReportVisibility;
  canEdit: boolean;
};
export type ReportDto = ReportSummary & {
  definition: ReportDefinition;
  schemaVersion: number;
};
export type ReportListQuery = {
  folderId?: string;
  q?: string;
  object?: ReportObject;
};
export type ReportListResponse = { reports: ReportSummary[] };
export type ReportCreateRequest = ReportInput;
export type ReportUpdateRequest = Partial<ReportInput>;
export type ReportResponse = { report: ReportDto };

// Run: needs `reports.view` and `view` on the object's module.
export type RunRequest = { definition: ReportDefinition; tz?: string };
export type RunQuery = { tz?: string };
export type RunResponse = { result: ReportResult };

// Export: also needs `reports.export` and `export` on the object's module; max 5000 rows.
export type ExportMode = "rows" | "grouped";
export type ExportQuery = { mode?: ExportMode; tz?: string };

// Dashboards: GET list, POST create, GET/PATCH/DELETE [id].
export type DashboardDto = Audit & {
  id: string;
  name: string;
  description: string;
  visibility: ReportVisibility;
  teamId: string | null;
  widgets: DashboardWidget[];
  canEdit: boolean;
};
export type DashboardListResponse = {
  dashboards: Omit<DashboardDto, "widgets">[];
};
export type DashboardCreateRequest = DashboardInput;
export type DashboardUpdateRequest = Partial<DashboardInput>;
export type DashboardResponse = { dashboard: DashboardDto };

/** One entry per widget id. A failed/forbidden widget carries no report name. */
export type DashboardWidgetData =
  | {
      ok: true;
      report: { id: string; name: string };
      chart: ReportChart;
      result: ReportResult;
    }
  | { ok: false; error: "forbidden" | "not_found" | "invalid" | "failed" };
export type DashboardDataQuery = { tz?: string };
export type DashboardDataResponse = {
  widgets: Record<string, DashboardWidgetData>;
};

// Home layout. GET without `scope` = resolved (user, then team, then default, then null).
export type HomeLayoutQuery = { scope?: HomeLayoutScope; teamId?: string };
export type HomeLayoutResponse = {
  /** Scope the widgets came from; null when nothing is saved (use the builtin default). */
  source: HomeLayoutScope | null;
  widgets: HomeWidget[] | null;
  /** Scopes the viewer may PUT. */
  canWrite: HomeLayoutScope[];
};
export type HomeLayoutPutRequest = HomeLayoutInput;
export type HomeLayoutPutQuery = { scope: HomeLayoutScope; teamId?: string };
