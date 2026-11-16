// RLS suite setup (runs once, before every tests/rls file):
//   * creates a temporary active super_admin (rls-admin-<rand>@example.com);
//   * creates fixtures owned by Lucas, Camila (reps, Ricardo's team), Ricardo
//     (manager) and Pieter (rep, Sanne's team): one account, contact, lead,
//     opportunity and activity each, plus a second set owned by Lucas that the
//     soft-delete test removes. Every fixture carries external_ref 'rls-test:<run>:<label>:<object>'
//   * signs every user in once and hands the access tokens to the tests.
// Teardown hard-deletes the fixtures (and their audit rows), anything else
// tagged with the run id, and the temporary admin.
import { randomBytes, randomUUID } from "node:crypto";
import type { GlobalSetupContext } from "vitest/node";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DEMO_EMAILS, testEnv, type DemoKey } from "../support/env";
import type { Fixture, ObjectKey, RlsContext } from "./context";

const PIPELINE = "00000000-0000-4000-8000-000000000001";
const STAGE_PROSPECTING = "00000000-0000-4000-8000-000000000101";

const TABLES: Record<ObjectKey, string> = {
  account: "crm_accounts",
  contact: "crm_contacts",
  lead: "crm_leads",
  opportunity: "crm_opportunities",
  activity: "crm_activities",
};
// Children first, so FKs never block the hard delete.
const DELETE_ORDER: ObjectKey[] = ["activity", "lead", "opportunity", "contact", "account"];

function must<T>(result: { data: T; error: { message: string } | null }, label: string): NonNullable<T> {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data as NonNullable<T>;
}

async function createFixture(
  db: SupabaseClient,
  ownerId: string,
  ref: string,
  label: string,
): Promise<Fixture> {
  const tag = `rls ${label} ${ref}`;
  const account = must(
    await db
      .from("crm_accounts")
      .insert({ name: `${tag} account`, owner_id: ownerId, external_ref: `${ref}:${label}:account` })
      .select("id")
      .single(),
    "insert account",
  );
  const contact = must(
    await db
      .from("crm_contacts")
      .insert({
        last_name: `${tag} contact`,
        account_id: account.id,
        owner_id: ownerId,
        external_ref: `${ref}:${label}:contact`,
      })
      .select("id")
      .single(),
    "insert contact",
  );
  const lead = must(
    await db
      .from("crm_leads")
      .insert({
        last_name: `${tag} lead`,
        company: `${tag} company`,
        email: `rls-${randomUUID()}@example.com`,
        owner_id: ownerId,
        external_ref: `${ref}:${label}:lead`,
      })
      .select("id")
      .single(),
    "insert lead",
  );
  const opportunity = must(
    await db
      .from("crm_opportunities")
      .insert({
        name: `${tag} opportunity`,
        account_id: account.id,
        pipeline_id: PIPELINE,
        stage_id: STAGE_PROSPECTING,
        owner_id: ownerId,
        external_ref: `${ref}:${label}:opportunity`,
      })
      .select("id")
      .single(),
    "insert opportunity",
  );
  const activity = must(
    await db
      .from("crm_activities")
      .insert({
        type: "task",
        subject: `${tag} activity`,
        what_object: "opportunity",
        what_id: opportunity.id,
        owner_id: ownerId,
        external_ref: `${ref}:${label}:activity`,
      })
      .select("id")
      .single(),
    "insert activity",
  );
  return {
    account: account.id,
    contact: contact.id,
    lead: lead.id,
    opportunity: opportunity.id,
    activity: activity.id,
  };
}

async function signIn(url: string, anonKey: string, email: string, password: string) {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`sign in ${email}: ${error?.message ?? "no session"}`);
  return data.session.access_token;
}

async function cleanup(db: SupabaseClient, ref: string, adminId: string | null) {
  const errors: string[] = [];
  for (const object of DELETE_ORDER) {
    const table = TABLES[object];
    const { data, error } = await db.from(table).select("id").like("external_ref", `${ref}:%`);
    if (error) {
      errors.push(`${table}: ${error.message}`);
      continue;
    }
    const ids = (data ?? []).map((row: { id: string }) => row.id);
    if (!ids.length) continue;
    if (object === "account") {
      await db.from(table).update({ parent_account_id: null }).in("id", ids);
    }
    const del = await db.from(table).delete().in("id", ids);
    if (del.error) errors.push(`delete ${table}: ${del.error.message}`);
    const audit = await db.from("crm_audit_logs").delete().in("record_id", ids);
    if (audit.error) errors.push(`delete audit ${table}: ${audit.error.message}`);
  }
  if (adminId) {
    // Audit rows written by the temporary admin are removed above (record ids);
    // deleting the auth user cascades to crm_users.
    const { error } = await db.auth.admin.deleteUser(adminId);
    if (error) errors.push(`delete admin: ${error.message}`);
  }
  if (errors.length) throw new Error(`RLS teardown: ${errors.join("; ")}`);
}

export default async function setup({ provide }: GlobalSetupContext) {
  const env = testEnv();
  const db = createClient(env.url, env.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const run = randomBytes(6).toString("hex");
  const ref = `rls-test:${run}`;

  const users = must(
    await db
      .from("crm_users")
      .select("id, email, role, team_id, status")
      .in("email", Object.values(DEMO_EMAILS)),
    "load demo users",
  ) as { id: string; email: string; role: string; team_id: string | null; status: string }[];
  const ids = {} as Record<DemoKey, string>;
  for (const [key, email] of Object.entries(DEMO_EMAILS) as [DemoKey, string][]) {
    const user = users.find((u) => u.email.toLowerCase() === email);
    if (!user || user.status !== "active") {
      throw new Error(`Demo user ${email} missing or inactive. Run npm run seed:demo first.`);
    }
    ids[key] = user.id;
  }

  // Temporary super admin.
  const adminEmail = `rls-admin-${run}@example.com`;
  const adminPassword = `${randomBytes(18).toString("base64url")}aA1!`;
  const created = await db.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
    user_metadata: { full_name: `RLS admin ${run}` },
  });
  if (created.error || !created.data.user) {
    throw new Error(`create temp admin: ${created.error?.message}`);
  }
  const adminId = created.data.user.id;

  try {
    must(
      await db.from("crm_users").upsert(
        {
          id: adminId,
          email: adminEmail,
          full_name: `RLS admin ${run}`,
          role: "super_admin",
          status: "active",
        },
        { onConflict: "id" },
      ),
      "activate temp admin",
    );

    const fixtures = {
      lucas: await createFixture(db, ids.lucas, ref, "lucas"),
      camila: await createFixture(db, ids.camila, ref, "camila"),
      ricardo: await createFixture(db, ids.ricardo, ref, "ricardo"),
      pieter: await createFixture(db, ids.pieter, ref, "pieter"),
      lucasDeletable: await createFixture(db, ids.lucas, ref, "lucas-del"),
    };

    const tokens = {} as RlsContext["tokens"];
    for (const key of Object.keys(DEMO_EMAILS) as DemoKey[]) {
      tokens[key] = await signIn(env.url, env.anonKey, DEMO_EMAILS[key], env.demoPassword);
    }
    tokens.admin = await signIn(env.url, env.anonKey, adminEmail, adminPassword);

    const context: RlsContext = {
      url: env.url,
      anonKey: env.anonKey,
      ref,
      run,
      users: { ...ids, admin: adminId },
      tokens,
      fixtures,
    };
    provide("rls", context);
  } catch (error) {
    await cleanup(db, ref, adminId).catch(() => undefined);
    throw error;
  }

  return async () => {
    await cleanup(db, ref, adminId);
  };
}
