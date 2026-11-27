import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient, isServiceRoleConfigured } from "@/lib/supabase/admin";
import { MAX_BODY_BYTES, SIGNATURE_HEADER, decodeUtf8Strict, verifySignature } from "@/lib/crm/inbound/signature";
import { parseInboundPayload, type InboundPayload } from "@/lib/crm/inbound/schema";
import {
  deriveIdempotencyKeys,
  isInvalidIdempotencyHeader,
  mapToActivityNote,
  mapToLead,
  resolveEntityId,
} from "@/lib/crm/inbound/map";

/**
 * POST /api/inbound/leads — website contact / RFQ submissions (contract in
 * docs/INBOUND-LEADS.md). No user session: HMAC-signed, writes with the
 * service role (allowed here by AGENTS.md rule 7).
 */
export const dynamic = "force-dynamic";

type Keys = ReturnType<typeof deriveIdempotencyKeys>;
type Result = { status: number; body: Record<string, unknown> };

const json = (body: Record<string, unknown>, status: number) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

class BodyTooLarge extends Error {}

/** Raw request bytes, capped at MAX_BODY_BYTES (the HMAC is computed over these). */
async function readBody(request: Request): Promise<Buffer> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) throw new BodyTooLarge();
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new BodyTooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === "23505";
}

/** Escapes LIKE wildcards so ilike behaves as a case-insensitive equality. */
function likeExact(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

type Replay = { result: Result | null; staleActivityRef: boolean };
type ActivityHit = { what_object: string | null; what_id: string | null; external_ref: string | null };

/** Live (non-deleted) parent of a replayed activity; deleted parents do not count as a replay. */
async function liveParent(db: SupabaseClient, hits: ActivityHit[]): Promise<ActivityHit | null> {
  for (const hit of hits) {
    if (!hit.what_id || (hit.what_object !== "lead" && hit.what_object !== "contact")) continue;
    const table = hit.what_object === "lead" ? "crm_leads" : "crm_contacts";
    const parent = await db.from(table).select("id").eq("id", hit.what_id).is("deleted_at", null).maybeSingle();
    if (parent.error) throw parent.error;
    if (parent.data) return hit;
  }
  return null;
}

async function findReplay(db: SupabaseClient, keys: Keys): Promise<Replay> {
  if (keys.all.length === 0) return { result: null, staleActivityRef: false };

  // A soft-deleted lead is not a replay: the submission is processed as new
  // (external_ref is unique among live leads only, see 20261116000700).
  const lead = await db
    .from("crm_leads")
    .select("id")
    .in("external_ref", keys.all)
    .is("deleted_at", null)
    .limit(1);
  if (lead.error) throw lead.error;
  if (lead.data[0]) return { result: { status: 200, body: { leadId: lead.data[0].id, replayed: true } }, staleActivityRef: false };

  // Same rule for dedupe notes: a note whose parent lead/contact was soft
  // deleted is not a replay.
  const byRef = await db
    .from("crm_activities")
    .select("what_object, what_id, external_ref")
    .in("external_ref", keys.all)
    .limit(10);
  if (byRef.error) throw byRef.error;
  let activity = await liveParent(db, byRef.data);
  if (!activity && keys.header) {
    const byMeta = await db
      .from("crm_activities")
      .select("what_object, what_id, external_ref")
      .eq("meta->>idempotencyKey", keys.header)
      .limit(10);
    if (byMeta.error) throw byMeta.error;
    activity = await liveParent(db, byMeta.data);
  }
  // A stale note still holds the key in crm_activities.external_ref (unique):
  // a new note must then be stored without it.
  const staleActivityRef = byRef.data.some((a) => a.external_ref === keys.primary);
  if (!activity) return { result: null, staleActivityRef };
  const idKey = activity.what_object === "contact" ? "contactId" : "leadId";
  return {
    result: { status: 200, body: { [idKey]: activity.what_id, deduplicated: true, replayed: true } },
    staleActivityRef: false,
  };
}

async function processPayload(
  db: SupabaseClient,
  payload: InboundPayload,
  keys: Keys,
  entityId: string,
  attempt = 0
): Promise<Result> {
  const replay = await findReplay(db, keys);
  if (replay.result) return replay.result;

  const existing = await db
    .from("crm_leads")
    .select("id, owner_id, converted_at, converted_contact_id")
    .is("deleted_at", null)
    .ilike("email", likeExact(payload.email))
    .limit(1);
  if (existing.error) throw existing.error;
  const lead = existing.data[0];

  if (lead) {
    const note = mapToActivityNote(payload, keys);
    let target: { object: "lead" | "contact"; id: string; owner: string } = {
      object: "lead",
      id: lead.id,
      owner: lead.owner_id,
    };
    if (lead.converted_at && lead.converted_contact_id) {
      const contact = await db
        .from("crm_contacts")
        .select("id, owner_id")
        .eq("id", lead.converted_contact_id)
        .is("deleted_at", null)
        .maybeSingle();
      if (contact.error) throw contact.error;
      if (contact.data) target = { object: "contact", id: contact.data.id, owner: contact.data.owner_id };
    }

    const now = new Date().toISOString();
    const inserted = await db.from("crm_activities").insert({
      type: "note",
      status: "done",
      subject: note.subject,
      body: note.body,
      meta: note.meta,
      what_object: target.object,
      what_id: target.id,
      who_contact_id: target.object === "contact" ? target.id : null,
      owner_id: target.owner,
      external_ref: replay.staleActivityRef ? null : keys.primary,
    });
    if (isUniqueViolation(inserted.error) && attempt === 0) {
      return processPayload(db, payload, keys, entityId, attempt + 1);
    }
    if (inserted.error) throw inserted.error;

    if (target.object === "lead") {
      const bumped = await db.from("crm_leads").update({ last_activity_at: now }).eq("id", lead.id);
      if (bumped.error) throw bumped.error;
      return { status: 200, body: { leadId: lead.id, deduplicated: true } };
    }
    return { status: 200, body: { contactId: target.id, deduplicated: true } };
  }

  // No owner_id: the BEFORE INSERT trigger on crm_leads assigns it (rules, then
  // the Setup fallback) and audits the insert as "Automation".
  const created = await db
    .from("crm_leads")
    .insert({
      ...mapToLead(payload, keys.primary),
      status: "new",
      entity_id: entityId,
    })
    .select("id")
    .single();
  // Lost a race on the email or external_ref unique index: re-run once so the
  // request resolves to the winner (replay or dedupe).
  if (isUniqueViolation(created.error) && attempt === 0) {
    return processPayload(db, payload, keys, entityId, attempt + 1);
  }
  if (created.error) throw created.error;
  return { status: 201, body: { leadId: created.data.id } };
}

export async function POST(request: Request) {
  const secret = process.env.INBOUND_LEADS_SECRET?.trim();
  if (!secret || !isServiceRoleConfigured()) {
    return json({ error: "Service unavailable" }, 503);
  }

  let rawBytes: Buffer;
  try {
    rawBytes = await readBody(request);
  } catch (error) {
    if (error instanceof BodyTooLarge) return json({ error: "Payload too large" }, 413);
    return json({ error: "Bad request" }, 400);
  }

  const signature = verifySignature(secret, request.headers.get(SIGNATURE_HEADER), rawBytes);
  if (!signature.ok) return json({ error: "Unauthorized" }, 401);

  const rawBody = decodeUtf8Strict(rawBytes);
  if (rawBody === null) return json({ error: "Invalid encoding" }, 400);

  let input: unknown;
  try {
    input = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const parsed = parseInboundPayload(input);
  if (!parsed.ok) return json({ error: "Invalid payload", issues: parsed.issues }, 400);
  const payload = parsed.data;

  const idempotencyHeader = request.headers.get("idempotency-key");
  if (isInvalidIdempotencyHeader(idempotencyHeader)) {
    return json({ error: "Invalid payload", issues: [{ path: "Idempotency-Key", code: "invalid_header" }] }, 400);
  }
  const keys = deriveIdempotencyKeys(idempotencyHeader, payload);

  try {
    const db = createServiceClient();

    const entities = await db.from("crm_entities").select("id, name").eq("active", true);
    if (entities.error) throw entities.error;
    const entityId = resolveEntityId(payload.entity, entities.data);
    if (!entityId) {
      return json({ error: "Invalid payload", issues: [{ path: "entity", code: "unknown_entity" }] }, 400);
    }

    const result = await processPayload(db, payload, keys, entityId);
    return json(result.body, result.status);
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    console.error("[inbound/leads] failed", code ?? (error instanceof Error ? error.message : "unknown"));
    return json({ error: "Internal error" }, 500);
  }
}
