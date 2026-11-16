import { inject } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { DemoKey } from "../support/env";

export type ObjectKey = "account" | "contact" | "lead" | "opportunity" | "activity";
export type Fixture = Record<ObjectKey, string>;
export type Actor = DemoKey | "admin";

export interface RlsContext {
  url: string;
  anonKey: string;
  ref: string;
  run: string;
  users: Record<Actor, string>;
  tokens: Record<Actor, string>;
  fixtures: {
    lucas: Fixture;
    camila: Fixture;
    ricardo: Fixture;
    pieter: Fixture;
    lucasDeletable: Fixture;
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    rls: RlsContext;
  }
}

export const OBJECTS: { key: ObjectKey; table: string }[] = [
  { key: "lead", table: "crm_leads" },
  { key: "account", table: "crm_accounts" },
  { key: "contact", table: "crm_contacts" },
  { key: "opportunity", table: "crm_opportunities" },
  { key: "activity", table: "crm_activities" },
];

export function ctx(): RlsContext {
  return inject("rls");
}

const clients = new Map<string, SupabaseClient>();

/** Supabase client acting with the actor's real JWT (anon key + Bearer token). */
export function as(actor: Actor): SupabaseClient {
  const c = ctx();
  const existing = clients.get(actor);
  if (existing) return existing;
  const token = c.tokens[actor];
  const client = createClient(c.url, c.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  clients.set(actor, client);
  return client;
}

export function anon(): SupabaseClient {
  const c = ctx();
  return createClient(c.url, c.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Ids from `ids` that `client` can select from `table`. */
export async function visibleIds(
  client: SupabaseClient,
  table: string,
  ids: string[],
): Promise<string[]> {
  const { data, error } = await client.from(table).select("id").in("id", ids);
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data ?? []).map((row: { id: string }) => row.id).sort();
}
