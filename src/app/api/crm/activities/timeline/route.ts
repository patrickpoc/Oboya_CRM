import { NextResponse } from "next/server";
import { z } from "zod";
import { ACTIVITY_PARENTS, activityConfig } from "@/lib/crm/objects/activity";
import { errorResponse, invalid } from "@/lib/crm/objects/route-helpers";
import { OBJECT_META, type RecordRow } from "@/lib/crm/objects/types";
import { canAccessUser } from "@/lib/crm/permissions/access-resolve";
import { getStages, getUsers } from "@/lib/crm/repositories/lookups";
import { list } from "@/lib/crm/repositories/object-repository";
import { crmGuard } from "@/lib/crm/server/require-crm-auth";
import { toTimelineEvent, type AuditRow } from "@/lib/crm/activities/audit";
import type { TimelineAuditEvent } from "@/lib/crm/activities/types";

const querySchema = z.object({ object: z.enum(ACTIVITY_PARENTS), id: z.guid() });
const AUDIT_ACTIONS = ["create", "stage_change", "convert", "owner_change"] as const;
const LIMIT = 200;

/**
 * GET /api/crm/activities/timeline?object=&id= — activities of a record
 * (what_object/what_id; on a contact also who_contact_id) and its key audit
 * events. All reads use the user's client: RLS scopes activities and audit
 * logs; audit events are skipped without audit_logs.view. Lead status changes
 * are stage_change events (diff `status`, see lib/crm/activities/audit.ts).
 */
export async function GET(request: Request) {
  const guard = await crmGuard("activities", "view");
  if (guard instanceof NextResponse) return guard;
  const params = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({ object: params.get("object"), id: params.get("id") });
  if (!parsed.success) return invalid();
  const { object, id } = parsed.data;
  const client = guard.supabase;

  try {
    const parent = await client.from(OBJECT_META[object].table).select("id").eq("id", id).is("deleted_at", null).maybeSingle();
    if (parent.error) return errorResponse(parent.error, "timeline parent");
    if (!parent.data) return NextResponse.json({ error: "Not found", code: "not_found" }, { status: 404 });

    const ctx = { userId: guard.user.id };
    const query = (filters: Record<string, string[]>) =>
      list(client, activityConfig, { view: "all", q: "", filters, sort: "created_at", dir: "desc", page: 0, pageSize: LIMIT }, ctx);
    const results = await Promise.all([
      query({ what_object: [object], what_id: [id] }),
      object === "contact" ? query({ who_contact_id: [id] }) : Promise.resolve({ rows: [] as RecordRow[], total: 0 }),
    ]);
    const seen = new Set<string>();
    const activities = results.flatMap((r) => r.rows).filter((row) => !seen.has(row.id) && seen.add(row.id));

    let events: TimelineAuditEvent[] = [];
    if (canAccessUser(guard.user, "audit_logs", "view", guard.matrix)) {
      const { data, error } = await client
        .from("crm_audit_logs")
        .select("id, action, actor_name, diff, created_at")
        .eq("object", object)
        .eq("record_id", id)
        .in("action", [...AUDIT_ACTIONS])
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) console.error("[timeline] audit read failed:", error.code);
      const rows = (data ?? []) as AuditRow[];
      const [users, stages] = await Promise.all([getUsers(client), object === "opportunity" ? getStages(client) : []]);
      const userName = new Map(users.map((u) => [u.value, u.label]));
      const stageName = new Map(stages.map((s) => [s.value, s.label]));
      events = rows.map((row) => toTimelineEvent(object, row, userName, stageName));
    }

    return NextResponse.json({ activities, events });
  } catch (error) {
    return errorResponse(error, "timeline");
  }
}
