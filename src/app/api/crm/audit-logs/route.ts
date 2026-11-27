import { NextResponse } from "next/server";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { dbErrorResponse, jsonError } from "@/lib/crm/setup/api.server";
import { auditDateBounds, isAuditAction, isAuditObject, resolveActorName } from "@/lib/crm/setup/audit";
import type { SetupAuditLog } from "@/lib/crm/setup/rows";
import { auditQuerySchema } from "@/lib/crm/setup/schemas";

export const dynamic = "force-dynamic";

/**
 * GET /api/crm/audit-logs?object=&action=&actor=&from=&to=&page=&pageSize=
 * RLS decides which rows are visible (admin: all; audit_logs.view: records
 * the user can see, and config objects with the matching setup_* view).
 */
export async function GET(request: Request) {
  const guard = await crmGuard("audit_logs", "view");
  if (guard instanceof NextResponse) return guard;

  const params = Object.fromEntries(
    [...new URL(request.url).searchParams.entries()].filter(([, v]) => v !== "")
  );
  const parsed = auditQuerySchema.safeParse(params);
  if (!parsed.success) return jsonError(400, "invalid_input", "Invalid filters");
  const q = parsed.data;
  if (q.object && !isAuditObject(q.object)) return jsonError(400, "invalid_input", "Invalid object");
  if (q.action && !isAuditAction(q.action)) return jsonError(400, "invalid_input", "Invalid action");

  let query = guard.supabase
    .from("crm_audit_logs")
    .select("id, actor_id, actor_name, object, record_id, record_key, action, diff, context, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(q.page * q.pageSize, q.page * q.pageSize + q.pageSize - 1);
  if (q.object) query = query.eq("object", q.object);
  if (q.action) query = query.eq("action", q.action);
  if (q.actor) query = query.eq("actor_id", q.actor);
  const bounds = auditDateBounds(q.from, q.to);
  if (bounds.gte) query = query.gte("created_at", bounds.gte);
  if (bounds.lt) query = query.lt("created_at", bounds.lt);

  const [logs, users] = await Promise.all([
    query,
    guard.supabase.from("crm_users").select("id, full_name, email").order("full_name"),
  ]);
  if (logs.error) return dbErrorResponse(logs.error, "Audit log read");
  if (users.error) return dbErrorResponse(users.error, "Users read");

  const names = new Map((users.data ?? []).map((u) => [u.id, u.full_name || u.email]));
  const rows: SetupAuditLog[] = (logs.data ?? []).map((row) => ({
    id: row.id,
    actorId: row.actor_id,
    actorName: resolveActorName(row.actor_id, row.actor_name, names),
    object: row.object,
    recordId: row.record_id,
    recordKey: row.record_key ?? null,
    action: row.action,
    diff: (row.diff ?? {}) as SetupAuditLog["diff"],
    context: (row.context ?? null) as SetupAuditLog["context"],
    createdAt: row.created_at,
  }));

  return NextResponse.json({
    logs: rows,
    total: logs.count ?? rows.length,
    page: q.page,
    pageSize: q.pageSize,
    actors: (users.data ?? []).map((u) => ({ id: u.id, name: u.full_name || u.email })),
  });
}
