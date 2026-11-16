"use client";

import { apiFetch } from "@/components/crm/record/api";
import type { RecordRow } from "@/lib/crm/objects/types";

export type MoveStageBody = { stageId: string; lossReason?: string | null; lossNote?: string | null };

export function moveOpportunityStage(id: string, body: MoveStageBody) {
  return apiFetch<{ record: RecordRow }>(`/api/crm/opportunities/${id}/stage`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
