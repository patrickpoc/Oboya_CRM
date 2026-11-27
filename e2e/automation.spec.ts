// Automation flow through the real UI (needs the demo seed, DEMO_PASSWORD and the
// automation migration applied). A temporary super_admin (created here with the
// service role) adds a "Qualification" stage task template assigned to the owner's
// manager. Rep Lucas moves one of his opportunities into Qualification; the engine
// creates the task and a real task_assigned notification for his manager (Ricardo),
// who sees the "Automated" badge and reads the bell. Repeated at 375px.
// Created data is named "E2E Automation <rand>" and removed by e2e/global-teardown.ts
// (template, its tasks, their notifications, the temp admin).
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { DEMO_EMAILS, requireEnv } from "../tests/support/env";

const RAND = randomBytes(4).toString("hex");
const SUBJECT = `E2E Automation ${RAND}`;
const ADMIN_EMAIL = `e2e-automation-admin-${RAND}@example.com`;
const ADMIN_PASSWORD = `Pw-${randomBytes(9).toString("hex")}`;

let db: SupabaseClient;
let adminId: string | null = null;
let lucasId = "";
let ricardoId = "";
let oppId = "";
let originalStageId = "";

async function login(page: Page, baseURL: string | undefined, email: string, password: string) {
  await page.context().clearCookies();
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL ?? "http://127.0.0.1:3100" }]);
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/dashboard/);
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Unread notifications of a user, read with the service role (only used to prove the count rose). */
async function unreadFor(userId: string) {
  const { count, error } = await db
    .from("crm_notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) throw new Error(`unread count: ${error.message}`);
  return count ?? 0;
}

/** Puts the opportunity back where it was so the next run (and the demo data) is unchanged. */
async function resetOpportunity() {
  await db.from("crm_opportunities").update({ stage_id: originalStageId }).eq("id", oppId);
}

test.beforeAll(async () => {
  db = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const created = await db.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: "E2E Automation Admin" },
  });
  if (created.error || !created.data.user) throw new Error(`temp admin: ${created.error?.message}`);
  adminId = created.data.user.id;
  const profile = await db
    .from("crm_users")
    .upsert({ id: adminId, email: ADMIN_EMAIL, full_name: "E2E Automation Admin", role: "super_admin", status: "active", locale: "en" }, { onConflict: "id" });
  if (profile.error) throw new Error(`temp admin profile: ${profile.error.message}`);

  const lucas = await db.from("crm_users").select("id").eq("email", DEMO_EMAILS.lucas).single();
  if (lucas.error) throw new Error(`lucas: ${lucas.error.message}`);
  lucasId = lucas.data.id;

  const ricardo = await db.from("crm_users").select("id").eq("email", DEMO_EMAILS.ricardo).single();
  if (ricardo.error) throw new Error(`ricardo: ${ricardo.error.message}`);
  ricardoId = ricardo.data.id;

  const qualification = await db.from("crm_pipeline_stages").select("id").eq("label", "Qualification").limit(1).single();
  if (qualification.error) throw new Error(`stage: ${qualification.error.message}`);
  const opp = await db
    .from("crm_opportunities")
    .select("id, name, stage_id")
    .eq("owner_id", lucasId)
    .is("deleted_at", null)
    .neq("stage_id", qualification.data.id)
    .limit(1)
    .single();
  if (opp.error) throw new Error(`opportunity: ${opp.error.message}`);
  ({ id: oppId, stage_id: originalStageId } = opp.data);
});

test.afterAll(async () => {
  if (oppId) await resetOpportunity();
  // Templates, tasks and notifications are removed by global-teardown (shared cleanup path).
  if (adminId) await db.from("crm_users").delete().eq("id", adminId);
  if (adminId) await db.auth.admin.deleteUser(adminId);
});

/**
 * Lucas moves his opportunity into Qualification. The template assigns to the owner's
 * manager (Ricardo), so the engine itself creates the task and a real task_assigned
 * notification for Ricardo. No notification is seeded.
 */
async function triggerAndRead(page: Page, baseURL: string | undefined) {
  const unreadBefore = await unreadFor(ricardoId);
  await login(page, baseURL, DEMO_EMAILS.lucas, requireEnv("DEMO_PASSWORD"));
  await page.goto(`/opportunities/${oppId}`);
  await page.getByRole("navigation", { name: "Stage" }).getByRole("button", { name: "Qualification" }).click();
  await expect(page.getByText("Moved to Qualification")).toBeVisible();
  await expect.poll(() => unreadFor(ricardoId)).toBeGreaterThan(unreadBefore);

  // The manager sees the automated task with the badge, and the bell count went up.
  await login(page, baseURL, DEMO_EMAILS.ricardo, requireEnv("DEMO_PASSWORD"));
  await page.goto(`/opportunities/${oppId}`);
  const task = page.getByRole("listitem").filter({ hasText: SUBJECT }).first();
  await expect(task).toBeVisible();
  await expect(task.getByText("Automated", { exact: true })).toBeVisible();
  await expectNoHorizontalScroll(page);

  const bell = page.getByRole("button", { name: /^Notifications, \d+ unread$/ });
  await expect(bell).toBeVisible();
  await bell.click();
  const panel = page.getByRole("dialog", { name: "Notifications" });
  const unread = panel.locator('[data-unread="true"]');
  await expect(unread.first()).toBeVisible();
  const before = await unread.count();
  // Mark one read (opens its record), then mark all.
  await unread.first().click();
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: /^Notifications/ }).click();
  await expect(unread).toHaveCount(before - 1);
  await panel.getByRole("button", { name: "Mark all read" }).click();
  await expect(unread).toHaveCount(0);
  await expect(page.getByTestId("notification-badge")).toHaveCount(0);
  await expectNoHorizontalScroll(page);
}

test.describe.serial("automation", () => {
  test("admin adds a Qualification stage task; rep triggers it; manager reads the bell", async ({ page, baseURL }) => {
    await login(page, baseURL, ADMIN_EMAIL, ADMIN_PASSWORD);
    await page.goto("/automation?tab=stage-tasks");
    await expect(page.getByRole("heading", { name: "Automation", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: /Add task\s+Qualification/ }).click();
    await page.getByLabel("Subject").fill(SUBJECT);
    await page.getByLabel("Due in (days)").fill("2");
    await page.getByLabel("Assign to").selectOption({ label: "Owner's manager" });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(SUBJECT, { exact: true })).toBeVisible();

    await triggerAndRead(page, baseURL);
    await resetOpportunity();
  });

  test.describe("mobile 375px", () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test("assignment tab fits and the bell is a full-width sheet", async ({ page, baseURL }) => {
      await login(page, baseURL, ADMIN_EMAIL, ADMIN_PASSWORD);
      await page.goto("/automation");
      await expect(page.getByRole("heading", { name: "Automation", level: 1 })).toBeVisible();
      await expectNoHorizontalScroll(page);
      await page.getByRole("button", { name: /^Notifications/ }).click();
      const box = await page.getByRole("dialog", { name: "Notifications" }).boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(370);
    });

    test("manager receives the automated task and reads the bell", async ({ page, baseURL }) => {
      await triggerAndRead(page, baseURL);
      await resetOpportunity();
    });
  });
});
