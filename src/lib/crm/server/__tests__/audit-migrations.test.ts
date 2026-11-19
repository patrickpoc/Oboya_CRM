import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

// Real PostgreSQL, local memory only. Supabase's auth schema is the only stub;
// every application migration, trigger, grant and RLS policy runs unchanged.
const db = new PGlite({ extensions: { pgcrypto, pg_trgm } });
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const admin = "33333333-3333-4333-8333-333333333333";
const account = "44444444-4444-4444-8444-444444444444";
const lead = "55555555-5555-4555-8555-555555555555";
const ticket = "66666666-6666-4666-8666-666666666666";
const mailbox = "77777777-7777-4777-8777-777777777777";
const contact = "88888888-8888-4888-8888-888888888888";
const contactTicket = "99999999-9999-4999-8999-999999999999";
const accountActivity = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const contactActivity = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const hiddenTicket = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const hiddenActivity = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const unrelated = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
let beforeModules: Record<string, Record<string, unknown>>;
type AuditSnapshot = { actor_name: string; diff: Record<string, unknown>; [key: string]: unknown };
let historicalAudit: AuditSnapshot[];
const historicalFixtures = [
  { kind: "create", object: "email_account", action: "create", pair: [null, "legacy-create-cipher"], expected: [null, "[redacted]"] },
  { kind: "rotate", object: "email_account", action: "update", pair: ["legacy-old-cipher", "legacy-new-cipher"], expected: ["[redacted]", "[redacted, changed]"] },
  { kind: "delete", object: "email_account", action: "delete", pair: ["legacy-delete-cipher", null], expected: ["[redacted]", null] },
  { kind: "masked", object: "email_account", action: "update", pair: ["[redacted]", "[redacted, changed]"], expected: ["[redacted]", "[redacted, changed]"] },
  { kind: "malformed", object: "email_account", action: "update", pair: "legacy-malformed-cipher", expected: "[redacted]" },
  { kind: "unrelated", object: "settings", action: "update", pair: ["unrelated-old-value", "unrelated-new-value"], expected: ["unrelated-old-value", "unrelated-new-value"] },
];

async function asUser(userId: string, work: () => Promise<void>) {
  await db.exec("begin; set local role authenticated;");
  await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
  try { await work(); } finally { await db.exec("rollback"); }
}

beforeAll(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', email_confirmed_at timestamptz);
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select auth.jwt() ->> 'role' $$;
    grant usage on schema auth to anon, authenticated, service_role;
    -- Supabase platform defaults; the application migrations narrow these.
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    set search_path = public, extensions;
  `);
  const directory = path.resolve("supabase/migrations");
  for (const file of readdirSync(directory).filter((file) => file.endsWith(".sql")).sort()) {
    if (file.startsWith("20261119030000")) {
      // Synthetic historical events emulate already-deployed trigger output.
      for (const fixture of historicalFixtures) {
        await db.query(`insert into public.crm_audit_logs (actor_id, actor_name, object, record_id, action, diff, created_at)
          values ($1, $2, $3, $4, $5, $6::jsonb, '2026-11-18T08:00:00Z')`,
        [admin, `historical-fixture:${fixture.kind}`, fixture.object, mailbox, fixture.action,
          JSON.stringify({ password_encrypted: fixture.pair, label: ["Sales", "Support"] })]);
      }
      historicalAudit = (await db.query<AuditSnapshot>("select * from public.crm_audit_logs where actor_name like 'historical-fixture:%' order by id")).rows;
    }
    if (file.startsWith("20261118000000")) {
      // A module already exists; removing its cell is an intentional denial.
      // A later case seed must not grant email again because the key is absent.
      await db.exec(`begin;
        select set_config('request.jwt.claims', '{"sub":"${admin}","role":"authenticated"}', true);
        update public.crm_access_control set matrix = matrix #- '{sales_rep,email}';
        commit;`);
    }
    if (file.startsWith("20261116000750")) {
      await db.exec(`update public.crm_access_control set matrix =
        jsonb_set(jsonb_set(matrix - 'read_only', '{sales_rep,leads}', '["view","create","edit","convert"]'),
          '{sales_rep,industry_news}', '"none"') || '{"custom_role":{"accounts":["view"]}}'::jsonb`);
      beforeModules = (await db.query<{ matrix: typeof beforeModules }>("select matrix from public.crm_access_control")).rows[0].matrix;
    }
    try { await db.exec(readFileSync(path.join(directory, file), "utf8")); }
    catch (error) { throw new Error(`Migration ${file} failed`, { cause: error }); }
  }
  await db.exec(`
    insert into auth.users (id, email) values ('${alice}', 'alice@example.com'), ('${bob}', 'bob@example.com'), ('${admin}', 'admin@example.com'), ('${unrelated}', 'unrelated@example.com');
    update public.crm_users set status = 'active', role = case id when '${alice}'::uuid then 'sales_manager' when '${admin}'::uuid then 'super_admin' else 'sales_rep' end;
    insert into public.crm_accounts (id, name, owner_id) values ('${account}', 'Alice account', '${alice}');
    insert into public.crm_leads (id, last_name, owner_id, status, converted_at, converted_account_id)
      values ('${lead}', 'Converted buyer', '${alice}', 'qualified', now(), '${account}');
    insert into public.crm_cases (id, subject, owner_id, account_id) values ('${ticket}', 'Parent-visible case', '${bob}', '${account}');
    insert into public.crm_contacts (id, first_name, last_name, owner_id) values ('${contact}', 'Alice', 'Contact', '${alice}');
    insert into public.crm_cases (id, subject, owner_id, contact_id) values ('${contactTicket}', 'Contact-visible case', '${bob}', '${contact}');
    insert into public.crm_cases (id, subject, owner_id) values ('${hiddenTicket}', 'Hidden case', '${bob}');
    insert into public.crm_activities (id, type, subject, owner_id, what_object, what_id) values
      ('${accountActivity}', 'note', 'Bob activity on Alice account case', '${bob}', 'case', '${ticket}'),
      ('${contactActivity}', 'note', 'Bob activity on Alice contact case', '${bob}', 'case', '${contactTicket}'),
      ('${hiddenActivity}', 'note', 'Hidden activity', '${bob}', 'case', '${hiddenTicket}');
    update public.crm_users set permission_overrides = '{"grants":{"audit_logs":["view"]}}' where id = '${unrelated}';
    insert into public.crm_email_accounts (id, owner_id, label, email, provider, username, password_encrypted, smtp_host, smtp_port, imap_host, imap_port)
      values ('${mailbox}', '${alice}', 'Sales', 'sales@example.com', 'custom', 'sales', 'secret-ciphertext', 'smtp.example.com', 465, 'imap.example.com', 993);
  `);
}, 30_000);
afterAll(async () => { await db.close(); });

describe("full migration upgrade with customised permissions", () => {
  it("preserves every existing role and cell, adds only new module defaults and never revives deleted roles", async () => {
    const { rows: [{ matrix }] } = await db.query<{ matrix: typeof beforeModules }>("select matrix from public.crm_access_control");
    for (const [role, modules] of Object.entries(beforeModules)) {
      for (const [module, value] of Object.entries(modules)) expect(matrix[role][module]).toEqual(value);
    }
    expect(matrix.read_only).toBeUndefined();
    expect(matrix.custom_role).toEqual({ accounts: ["view"] });
    expect(matrix.sales_rep.industry_news).toBe("none");
    expect(matrix.sales_rep.email).toBeUndefined();
    expect(matrix.sales_rep.cases).toEqual(["view", "create", "edit", "delete"]);
  });

  it("incremental defaults preserve explicit denials and cannot be called by clients", async () => {
    const input = { sales_rep: { email: [], cases: "none" }, custom: { accounts: ["view"] } };
    const { rows: [{ result }] } = await db.query<{ result: unknown }>(
      "select public.crm_add_module_permissions($1::jsonb, 'cases', $2::jsonb) as result",
      [JSON.stringify(input), JSON.stringify({ sales_rep: "full", sales_manager: "full" })]
    );
    expect(result).toEqual(input);
    await asUser(alice, async () => {
      await expect(db.query("select public.crm_add_module_permissions('{}', 'cases', '{}')")).rejects.toMatchObject({ code: "42501" });
    });
  });
});

describe("converted leads after all module migrations", () => {
  it.each([alice, admin])("rejects ordinary changes even for an admin: %s", async (user) => {
    await asUser(user, async () => {
      await expect(db.query("update public.crm_leads set last_name = 'Bypass' where id = $1", [lead])).rejects.toMatchObject({ message: "lead_converted" });
    });
  });

  it("retains soft-delete and administrator restore exceptions", async () => {
    await asUser(alice, async () => {
      await db.query("select public.crm_soft_delete('lead', $1)", [lead]);
    });
    await asUser(admin, async () => {
      await db.query("select public.crm_soft_delete('lead', $1)", [lead]);
      await db.query("select public.crm_restore('lead', $1)", [lead]);
      expect((await db.query<{ deleted_at: null }>("select deleted_at from public.crm_leads where id = $1", [lead])).rows[0].deleted_at).toBeNull();
    });
  });
});

describe("case shared object helpers", () => {
  it("creates an activity and recent view for a case visible through a parent", async () => {
    await asUser(alice, async () => {
      expect((await db.query<{ allowed: boolean }>("select public.crm_can_see_record('case', $1) as allowed", [ticket])).rows[0].allowed).toBe(true);
      await db.query("insert into public.crm_activities (type, subject, what_object, what_id) values ('note', 'Customer update', 'case', $1)", [ticket]);
      await db.query("insert into public.crm_recent_views (object, record_id) values ('case', $1)", [ticket]);
      expect((await db.query("select id from public.crm_activities where what_id = $1", [ticket])).rows).toHaveLength(2);
    });
  });

  it("deletes and restores cases through the standard RPCs", async () => {
    await asUser(admin, async () => {
      await db.query("select public.crm_soft_delete('case', $1)", [ticket]);
      await db.query("select public.crm_restore('case', $1)", [ticket]);
      expect((await db.query<{ deleted_at: null }>("select deleted_at from public.crm_cases where id = $1", [ticket])).rows[0].deleted_at).toBeNull();
    });
  });

  it("reads another owner's cases, activities and audits through either parent and filters recent views", async () => {
    await asUser(alice, async () => {
      expect((await db.query<{ allowed: boolean }>("select public.crm_can_see($1) as allowed", [bob])).rows[0].allowed).toBe(false);
      for (const id of [ticket, contactTicket]) {
        expect((await db.query<{ allowed: boolean }>("select public.crm_can_see_record('case', $1) as allowed", [id])).rows[0].allowed).toBe(true);
        await db.query("insert into public.crm_recent_views (object, record_id) values ('case', $1) on conflict (user_id, object, record_id) do update set viewed_at = now()", [id]);
      }
      expect((await db.query<{ id: string }>("select c.id from public.crm_cases c join public.crm_recent_views r on r.record_id = c.id and r.object = 'case' order by c.id")).rows.map((row) => row.id)).toEqual([ticket, contactTicket]);
      expect((await db.query<{ id: string }>("select id from public.crm_activities order by id")).rows.map((row) => row.id)).toEqual([accountActivity, contactActivity]);
      const logs = (await db.query<{ record_id: string }>("select record_id from public.crm_audit_logs where object in ('case', 'activity') order by record_id")).rows.map((row) => row.record_id);
      expect(logs).toEqual([ticket, contactTicket, accountActivity, contactActivity]);
    });
  });

  it("keeps unrelated cases, activities and audit rows invisible even with audit permission", async () => {
    await asUser(unrelated, async () => {
      expect((await db.query("select id from public.crm_cases")).rows).toEqual([]);
      expect((await db.query("select id from public.crm_activities")).rows).toEqual([]);
      expect((await db.query("select id from public.crm_audit_logs where object in ('case', 'activity')")).rows).toEqual([]);
    });
  });

  it("requires audit permission in addition to parent visibility", async () => {
    await db.exec("begin");
    try {
      await db.query("update public.crm_users set permission_overrides = '{\"denies\":{\"audit_logs\":[\"view\"]}}' where id = $1", [alice]);
      await db.exec("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: alice, role: "authenticated" })]);
      expect((await db.query("select id from public.crm_cases")).rows).toHaveLength(2);
      expect((await db.query("select id from public.crm_activities")).rows).toHaveLength(2);
      expect((await db.query("select id from public.crm_audit_logs")).rows).toEqual([]);
    } finally { await db.exec("rollback"); }
  });

  it("reading a parent-visible activity audit does not grant deletion of another owner's activity", async () => {
    await asUser(alice, async () => {
      expect((await db.query("select id from public.crm_audit_logs where object = 'activity' and record_id = $1", [accountActivity])).rows).toHaveLength(1);
      await expect(db.query("select public.crm_soft_delete('activity', $1)", [accountActivity])).rejects.toMatchObject({ code: "P0002" });
    });
  });
});

describe("historical mailbox credential redaction", () => {
  it("masks only credential differences while preserving event identity, nulls and all other metadata", async () => {
    const rows = (await db.query<AuditSnapshot>("select * from public.crm_audit_logs where actor_name like 'historical-fixture:%' order by id")).rows;
    expect(rows).toHaveLength(historicalFixtures.length);
    rows.forEach((row, index) => {
      expect(row).toEqual({ ...historicalAudit[index], diff: { ...historicalAudit[index].diff, password_encrypted: historicalFixtures[index].expected } });
    });
  });

  it("does not rewrite rows when the redaction migration is repeated", async () => {
    const query = "select *, xmin::text as row_version from public.crm_audit_logs where actor_name like 'historical-fixture:%' order by id";
    const before = (await db.query(query)).rows;
    await db.exec(readFileSync(path.resolve("supabase/migrations/20261119030000_crm_visibility_and_credential_audit.sql"), "utf8"));
    expect((await db.query(query)).rows).toEqual(before);
  });
});

describe("owner-scoped mailbox deletion", () => {
  it("soft-deletes only an authorised owner's mailbox", async () => {
    await asUser(alice, async () => { await db.query("select public.crm_delete_email_account($1)", [mailbox]); });
    await asUser(admin, async () => {
      await expect(db.query("select public.crm_delete_email_account($1)", [mailbox])).rejects.toMatchObject({ code: "P0002" });
    });
  });

  it("an edit grant alone cannot delete or use a direct DELETE", async () => {
    await db.exec("begin");
    try {
      await db.query("update public.crm_users set permission_overrides = '{\"denies\":{\"email\":[\"delete\"]}}' where id = $1", [alice]);
      await db.exec("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: alice, role: "authenticated" })]);
      await expect(db.query("select public.crm_delete_email_account($1)", [mailbox])).rejects.toMatchObject({ code: "42501" });
    } finally { await db.exec("rollback"); }
    await asUser(alice, async () => {
      await expect(db.query("delete from public.crm_email_accounts where id = $1", [mailbox])).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("never copies encrypted mailbox passwords to audit history", async () => {
    const { rows } = await db.query<{ diff: Record<string, unknown> }>("select diff from public.crm_audit_logs where object = 'email_account'");
    expect(rows).not.toHaveLength(0);
    expect(JSON.stringify(rows)).not.toContain("secret-ciphertext");
  });

  it("keeps a redacted audit event when only the password changes", async () => {
    await asUser(alice, async () => {
      await db.query("update public.crm_email_accounts set password_encrypted = 'rotated-ciphertext' where id = $1", [mailbox]);
    });
    await db.exec("begin");
    try {
      await db.query("update public.crm_email_accounts set password_encrypted = 'rotated-ciphertext' where id = $1", [mailbox]);
      const { rows: [{ diff }] } = await db.query<{ diff: Record<string, unknown> }>("select diff from public.crm_audit_logs where object = 'email_account' order by id desc limit 1");
      expect(diff.password_encrypted).toEqual(["[redacted]", "[redacted, changed]"]);
      expect(JSON.stringify(diff)).not.toContain("ciphertext");
    } finally { await db.exec("rollback"); }
  });
});

describe("email threads become one case", () => {
  const fromEmail = (messageId: string, body: string, references: string[] = []) => db.query<{ result: { record: { id: string }; updated: boolean } }>(
    "select public.crm_case_from_email($1, 'Support request', 'buyer@example.com', $2, null, $3::text[]) as result",
    [messageId, body, references]
  ).then(({ rows }) => rows[0].result);

  it("appends a reply once, keeps retries idempotent and reopens only on a new message", async () => {
    await asUser(alice, async () => {
      const original = await fromEmail("<root@example.com>", "Original message");
      const reply = await fromEmail("<reply@example.com>", "Reply message", ["<root@example.com>"]);
      expect(reply).toEqual({ record: original.record, updated: true });
      await db.query("update public.crm_cases set status = 'resolved' where id = $1", [original.record.id]);
      await fromEmail("<reply@example.com>", "Reply message", ["<root@example.com>"]);
      const { rows: [record] } = await db.query<{ status: string; description: string }>("select status, description from public.crm_cases where id = $1", [original.record.id]);
      expect(record.status).toBe("resolved");
      expect(record.description).toContain("Original message");
      expect(record.description.match(/Reply message/g)).toHaveLength(1);
      const next = await fromEmail("<next@example.com>", "New reply", ["<root@example.com>", "<reply@example.com>"]);
      expect(next.record.id).toBe(original.record.id);
      expect((await db.query<{ status: string }>("select status from public.crm_cases where id = $1", [original.record.id])).rows[0].status).toBe("working");
    });
  });

  it("finds the same case when the reply is converted before the original", async () => {
    await asUser(alice, async () => {
      const reply = await fromEmail("<reply-first@example.com>", "Reply first", ["<original-later@example.com>"]);
      const original = await fromEmail("<original-later@example.com>", "Original later");
      expect(original.record.id).toBe(reply.record.id);
      expect((await db.query<{ description: string }>("select description from public.crm_cases where id = $1", [reply.record.id])).rows[0].description).toContain("Original later");
    });
  });

  it("cannot change a case that is visible only through a linked parent", async () => {
    await db.exec("begin");
    try {
      await db.query("update public.crm_cases set source_message_id = 'parent-thread@example.com' where id = $1", [ticket]);
      await db.exec("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: alice, role: "authenticated" })]);
      await expect(fromEmail("reply-parent@example.com", "Forbidden overwrite", ["parent-thread@example.com"])).rejects.toMatchObject({ code: "42501" });
    } finally { await db.exec("rollback"); }
  });

  it("an invisible case owned by another user does not leak or block the same message", async () => {
    await db.exec("begin");
    try {
      await db.query("insert into public.crm_cases (subject, owner_id, source_message_id) values ('Hidden', $1, 'same@example.com')", [bob]);
      await db.exec("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: alice, role: "authenticated" })]);
      expect((await fromEmail("same@example.com", "My own case")).updated).toBe(false);
      expect((await db.query("select id from public.crm_cases where source_message_id = 'same@example.com'")).rows).toHaveLength(1);
    } finally { await db.exec("rollback"); }
  });
});
