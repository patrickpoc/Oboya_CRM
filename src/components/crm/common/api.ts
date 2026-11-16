"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { CRM_QUIET_HEADER } from "@/components/crm/layout/CrmLoadingContext";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type ApiFetchInit = RequestInit & {
  /** Sends `x-crm-quiet: 1` so the global loading overlay stays off (polling, typeahead). */
  quiet?: boolean;
};

/** JSON fetch for `/api/crm/**`: no-store, JSON headers, throws ApiError on non-2xx. */
export async function apiFetch<T>(url: string, init?: ApiFetchInit): Promise<T> {
  const { quiet, ...rest } = init ?? {};
  const response = await fetch(url, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(quiet ? { [CRM_QUIET_HEADER]: "1" } : {}),
      ...(rest.headers ?? {}),
    },
    cache: "no-store",
  });
  const body = (await response.json().catch(() => null)) as
    | (T & { error?: string; code?: string; fields?: Record<string, string> })
    | null;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.code ?? (response.status === 401 ? "unauthenticated" : "unavailable"),
      body?.error ?? response.statusText,
      body?.fields
    );
  }
  return body as T;
}

const RECORD_CODES = new Set(["invalid", "forbidden", "not_found", "duplicate", "unauthenticated"]);

/**
 * The one ApiError -> translated message mapper.
 * 1. `record.errors.rules.<code>` (for code "rule", the server's rule id in `error`) when that key exists.
 * 2. `scope: "record"` (default): `record.errors.<code>` / `rule` / `unavailable`.
 *    `scope: "setup"`: `setup.errors.<code>`, else the server text, else `setup.errors.failed`.
 */
export function useApiErrorMessage(scope: "record" | "setup" = "record") {
  const tRecord = useTranslations("record.errors");
  const tSetup = useTranslations("setup.errors");
  return useCallback(
    (error: unknown) => {
      if (!(error instanceof ApiError)) return scope === "setup" ? tSetup("failed") : tRecord("unavailable");
      const ruleKeys = [`rules.${error.code}`];
      if (error.code === "rule" && error.message) ruleKeys.unshift(`rules.${error.message}`);
      for (const key of ruleKeys) if (tRecord.has(key)) return tRecord(key);
      if (scope === "setup") {
        if (tSetup.has(error.code)) return tSetup(error.code);
        return error.message || tSetup("failed");
      }
      if (RECORD_CODES.has(error.code)) return tRecord(error.code);
      if (error.code === "rule") return tRecord("rule", { message: error.message });
      return tRecord("unavailable");
    },
    [scope, tRecord, tSetup]
  );
}
