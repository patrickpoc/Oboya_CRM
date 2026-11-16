"use client";

import type { CrmObject } from "@/lib/crm/objects/types";
import { ActivityTimeline } from "./ActivityTimeline";

/**
 * Right-column activity timeline of a record page. `refreshKey` (the record's
 * updated_at) refetches the timeline after any save, path or stage change.
 */
export function ActivityTimelineSlot({
  object,
  recordId,
  refreshKey,
}: {
  object: CrmObject;
  recordId: string;
  refreshKey?: string;
}) {
  return <ActivityTimeline object={object} recordId={recordId} refreshKey={refreshKey} />;
}
