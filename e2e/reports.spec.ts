// Reports flow through the real UI as seeded demo users (needs the demo seed,
// DEMO_PASSWORD and the reports migration applied). A manager (Ricardo) builds
// an opportunity report grouped by stage with a bar chart, files it in a team
// folder, builds a dashboard and pins it on the Team home; a rep on that team
// (Lucas) sees it on Home, also at 375px. Everything created is named
// "E2E Reports <rand>" and removed by e2e/global-teardown.ts.
import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { DEMO_EMAILS, requireEnv } from "../tests/support/env";

const RAND = randomBytes(4).toString("hex");
const folderName = `E2E Reports folder ${RAND}`;
const reportName = `E2E Reports report ${RAND}`;
const dashboardName = `E2E Reports dashboard ${RAND}`;

async function login(page: Page, baseURL: string | undefined, email: string) {
  await page.context().clearCookies();
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL ?? "http://127.0.0.1:3100" }]);
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(requireEnv("DEMO_PASSWORD"));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/dashboard/);
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe.serial("reports and team home", () => {
  test("manager builds, files, dashboards and pins; rep sees it", async ({ page, baseURL }) => {
    await login(page, baseURL, DEMO_EMAILS.ricardo);

    // 1. Team folder from the index.
    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: "Reports & Dashboards", level: 1 })).toBeVisible();
    await page.getByRole("button", { name: "New folder" }).click();
    await page.getByLabel("Name").fill(folderName);
    await page.getByLabel("Who can see it").selectOption({ label: "Team" });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("heading", { name: folderName })).toBeVisible();

    // 2. Opportunity report grouped by stage, bar chart (builder UI, task 2).
    await page.getByRole("link", { name: "New report" }).click();
    await page.waitForURL(/\/reports\/new/);
    await page.getByLabel("Object").selectOption({ label: "Opportunities" });
    await page.getByLabel("Report type").selectOption({ label: "Summary" });
    await page.getByLabel("Group rows by").first().selectOption({ label: "Stage" });
    await page.getByLabel("Chart type").selectOption({ label: "Bar" });
    await expect(page.getByRole("table", { name: /.+/ }).first()).toBeAttached();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const save = page.getByRole("dialog");
    await save.getByLabel("Name").fill(reportName);
    await save.getByLabel("Folder").selectOption({ label: folderName });
    await save.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForURL(/\/reports\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: reportName, level: 1 })).toBeVisible();

    // 3. Dashboard with that widget.
    await page.goto("/reports?tab=dashboards");
    await page.getByRole("button", { name: "New dashboard" }).click();
    await page.getByLabel("Name").fill(dashboardName);
    await page.getByLabel("Who can see it").selectOption({ label: "Team" });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForURL(/\/reports\/dashboards\/[0-9a-f-]{36}$/);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Add a saved report").selectOption({ label: reportName });
    await page.getByRole("button", { name: "Add widget" }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Dashboard saved")).toBeVisible();
    await expect(page.getByRole("heading", { name: reportName, level: 3 })).toBeVisible();

    // 4. Pin on the Team home.
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Edit home" }).click();
    await page.getByLabel("Add widget").selectOption({ label: dashboardName });
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByLabel("Save as").selectOption({ label: "Team home" });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Home saved")).toBeVisible();
    await expect(page.getByRole("region", { name: dashboardName })).toBeVisible();

    // 5. A rep on that team sees it on Home.
    await login(page, baseURL, DEMO_EMAILS.lucas);
    await expect(page.getByRole("region", { name: dashboardName })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit home" })).toBeVisible();
  });

  test.describe("mobile 375px", () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test("rep sees the pinned dashboard without horizontal scroll", async ({ page, baseURL }) => {
      await login(page, baseURL, DEMO_EMAILS.lucas);
      await expect(page.getByRole("region", { name: dashboardName })).toBeVisible();
      await expectNoHorizontalScroll(page);

      await page.goto("/reports");
      await expect(page.getByRole("heading", { name: "Reports & Dashboards", level: 1 })).toBeVisible();
      await expect(page.getByRole("combobox", { name: "Folders" })).toBeVisible();
      await expectNoHorizontalScroll(page);
    });
  });
});
