// Smoke flow through the real UI as the seeded demo rep (Lucas Pereira).
// Needs the demo seed and DEMO_PASSWORD; records created here are removed by
// e2e/global-teardown.ts (leads with email e2e-*@example.com and what they
// were converted into).
import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { DEMO_EMAILS, requireEnv } from "../tests/support/env";

const password = () => requireEnv("DEMO_PASSWORD");

async function login(page: Page, baseURL: string | undefined) {
  // The CRM locale comes from the NEXT_LOCALE cookie; pin English for selectors.
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: "en", url: baseURL ?? "http://127.0.0.1:3100" }]);
  await page.goto("/login");
  // Wait for hydration: a submit before React attaches its handler is a no-op GET.
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Email").fill(DEMO_EMAILS.lucas);
  await page.getByLabel("Password").fill(password());
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(/\/dashboard/);
}

test("rep: lead → convert → stage moves → planned page", async ({ page, baseURL }) => {
  const rand = randomBytes(4).toString("hex");
  const email = `e2e-${rand}@example.com`;
  const company = `E2E Co ${rand}`;
  const oppName = `E2E Opp ${rand}`;

  // 1. Log in
  await login(page, baseURL);

  // 2. Create a lead from the list's New button
  await page.goto("/leads");
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("textbox", { name: /^Last name/ }).fill(`Smoke ${rand}`);
  await page.getByRole("textbox", { name: "Company", exact: true }).fill(company);
  await page.getByRole("textbox", { name: "Email", exact: true }).fill(email);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForURL(/\/leads\/[0-9a-f-]{36}$/);

  // 3. New → Working on the Path
  const leadPath = page.getByRole("navigation", { name: "Stage" });
  await expect(leadPath.getByRole("button", { name: "New" })).toHaveAttribute("aria-current", "step");
  await leadPath.getByRole("button", { name: "Working" }).click();
  await expect(page.getByText("Status updated")).toBeVisible();
  await expect(leadPath.getByRole("button", { name: "Working" })).toHaveAttribute("aria-current", "step");

  // 4. Convert with an opportunity
  await page.getByRole("button", { name: "Convert" }).click();
  const dialog = page.getByRole("dialog", { name: "Convert lead" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Opportunity name").fill(oppName);
  await dialog.getByRole("button", { name: "Convert" }).click();

  // 5. Lands on the new opportunity; move one open stage forward on the Path
  await page.waitForURL(/\/opportunities\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: oppName })).toBeVisible();
  const oppPath = page.getByRole("navigation", { name: "Stage" });
  await expect(oppPath.getByRole("button", { name: "Prospecting" })).toHaveAttribute("aria-current", "step");
  await oppPath.getByRole("button", { name: "Qualification" }).click();
  // The Path is optimistic: wait for the saved toast before leaving the page.
  await expect(page.getByText("Moved to Qualification")).toBeVisible();
  await expect(oppPath.getByRole("button", { name: "Qualification" })).toHaveAttribute("aria-current", "step");

  // 6. Pipeline: move the card with the "Move to…" control
  await page.goto("/opportunities/pipeline");
  const qualification = page.getByRole("region", { name: "Qualification" });
  await expect(qualification.getByRole("link", { name: oppName })).toBeVisible();
  await page.getByRole("combobox", { name: `Move ${oppName} to…` }).selectOption({ label: "Needs Analysis" });
  await expect(page.getByText("Moved to Needs Analysis", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Needs Analysis" }).getByRole("link", { name: oppName })).toBeVisible();
  await expect(qualification.getByRole("link", { name: oppName })).toHaveCount(0);

  // 7. A planned module page
  await page.goto("/quotes");
  await expect(page.getByRole("heading", { name: "Quotes", level: 1 })).toBeVisible();
  await expect(page.getByText("To be done", { exact: true })).toBeVisible();
  await expect(page.getByText("What this module will do")).toBeVisible();

  // 8. Insights / Industry news (live module, read-only for the demo rep)
  await page.goto("/industry-news");
  await expect(page.getByRole("heading", { name: "Industry News", level: 1 })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Configuration" })).toHaveCount(0);
});

test.describe("mobile 375px", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("dashboard loads and the sidebar drawer opens", async ({ page, baseURL }) => {
    await login(page, baseURL);
    await page.goto("/dashboard");
    const sidebar = page.getByRole("complementary", { name: "Main navigation" });
    await expect(sidebar).not.toBeInViewport();
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(sidebar).toBeInViewport();
    await expect(sidebar.getByRole("link", { name: "Leads" })).toBeVisible();
    // No horizontal page scroll at 375px.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.keyboard.press("Escape");
    await expect(sidebar).not.toBeInViewport();
  });
});
