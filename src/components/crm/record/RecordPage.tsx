import "server-only";

import { notFound } from "next/navigation";
import { AccessDenied } from "@/components/crm/permissions/AccessDenied";
import { requireRecordConfig } from "@/lib/crm/objects/registry";
import type { CrmObject, RecordLookups, RecordRow } from "@/lib/crm/objects/types";
import { isRecordId } from "@/lib/crm/objects/route-helpers";
import { loadLookups } from "@/lib/crm/repositories/lookups";
import { get, markViewed, related } from "@/lib/crm/repositories/object-repository";
import { requireCrmAuth } from "@/lib/crm/server/require-crm-auth";
import { RecordView } from "./RecordView";

/**
 * Server shell of a record page: auth, module check, load (RLS-scoped), mark
 * as recently viewed, then the client RecordView. 404 when the record is not
 * visible. Slots are rendered by RecordView (client components only).
 * `slots` builds them from the record already loaded here, so object pages
 * never read the record a second time.
 */
export type RecordSlots = { actionSlot?: React.ReactNode; pathSlot?: React.ReactNode };

export async function RecordPage({
  object,
  id,
  actionSlot,
  pathSlot,
  slots,
}: {
  object: CrmObject;
  id: string;
  actionSlot?: React.ReactNode;
  pathSlot?: React.ReactNode;
  slots?: (ctx: { record: RecordRow; lookups: RecordLookups }) => RecordSlots | Promise<RecordSlots>;
}) {
  const config = requireRecordConfig(object);
  const { supabase, user, can } = await requireCrmAuth();
  if (!can(config.module, "view")) return <AccessDenied />;
  if (!isRecordId(id)) notFound();

  const record = await get(supabase, config, id);
  if (!record) notFound();

  const [relatedLists, lookups] = await Promise.all([
    related(supabase, config, id),
    loadLookups(supabase),
    markViewed(supabase, config, id, { userId: user.id }),
  ]);
  const built = slots ? await slots({ record, lookups }) : {};

  return (
    <RecordView
      object={object}
      record={record}
      related={relatedLists}
      lookups={lookups}
      actionSlot={built.actionSlot ?? actionSlot}
      pathSlot={built.pathSlot ?? pathSlot}
    />
  );
}
