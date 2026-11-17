import { jsonError } from "@/lib/crm/setup/api.server";

/** Mail-provider failures never leak credentials or server text to the browser. */
export function mailError(context: string, error: unknown) {
  console.error(`${context} failed:`, error instanceof Error ? error.message : error);
  return jsonError(502, "offline", "Mail action failed");
}
