"use client";

import { apiFetch } from "@/components/crm/common/api";
import type { CrmEmailMatch } from "@/lib/crm/email/types";

export type CaseFromEmailInput = {
  messageId: string;
  inReplyTo?: string;
  references?: string[];
  subject: string;
  from: string;
  body: string;
  priority?: "low" | "normal" | "high" | "urgent";
  queue?: "support" | "logistics" | "quality" | "billing" | "escalation";
};

/** Create or update a case from the selected email; CRM links come from the reader match. */
export function createCaseFromEmail(
  input: CaseFromEmailInput,
  match: CrmEmailMatch | null
): Promise<{ record: { id: string }; updated: boolean }> {
  return apiFetch("/api/crm/cases/from-email", {
    method: "POST",
    body: JSON.stringify({
      ...input,
      accountId: match?.recordType === "account" ? match.id : (match?.accountId ?? undefined),
      contactId: match?.recordType === "contact" ? match.id : undefined,
    }),
  });
}
