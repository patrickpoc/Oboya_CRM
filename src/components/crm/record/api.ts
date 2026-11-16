"use client";

import { apiFetch } from "@/components/crm/common/api";
import type { CrmObject, RecordRow } from "@/lib/crm/objects/types";

/** Shared fetch + error mapping live in `components/crm/common/api`; re-exported for existing callers. */
export { ApiError, apiFetch, useApiErrorMessage, type ApiFetchInit } from "@/components/crm/common/api";

export function objectApiPath(object: CrmObject, suffix = "") {
  return `/api/crm/objects/${object}${suffix}`;
}

export function createRecord(object: CrmObject, values: Record<string, unknown>) {
  return apiFetch<{ record: RecordRow }>(objectApiPath(object), {
    method: "POST",
    body: JSON.stringify(values),
  });
}

export function updateRecord(object: CrmObject, id: string, patch: Record<string, unknown>) {
  return apiFetch<{ record: RecordRow }>(objectApiPath(object, `/${id}`), {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteRecord(object: CrmObject, id: string) {
  return apiFetch<{ ok: true }>(objectApiPath(object, `/${id}`), { method: "DELETE" });
}
