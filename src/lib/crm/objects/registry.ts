import { accountConfig } from "./account";
import { activityConfig } from "./activity";
import { caseConfig } from "./case";
import { contactConfig } from "./contact";
import { opportunityConfig } from "./opportunity";
import { leadConfig } from "./lead";
import { isCrmObject, type CrmObject, type RecordConfig } from "./types";

/**
 * Object configs by name. Client-safe (no server imports), so client
 * components resolve configs here by name instead of receiving them as props
 * (configs hold icons and zod schemas, which cannot cross the server/client
 * boundary). Tasks 7a–7d add their object here.
 */
const registry: Partial<Record<CrmObject, RecordConfig>> = {
  account: accountConfig,
  activity: activityConfig,
  case: caseConfig,
  opportunity: opportunityConfig,
  contact: contactConfig,
  lead: leadConfig,
};

export function getRecordConfig(object: string): RecordConfig | null {
  return isCrmObject(object) ? (registry[object] ?? null) : null;
}

export function requireRecordConfig(object: CrmObject): RecordConfig {
  const config = registry[object];
  if (!config) throw new Error(`No RecordConfig registered for "${object}"`);
  return config;
}

export function registeredObjects(): CrmObject[] {
  return Object.keys(registry) as CrmObject[];
}
