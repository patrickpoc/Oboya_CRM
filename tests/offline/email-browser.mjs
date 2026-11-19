// Actual mail UI + real browser IndexedDB. Every HTTP endpoint is local and fake.
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFileSync, readdirSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const cwd = process.cwd();
const scratch = mkdtempSync(path.join(tmpdir(), "oboya-email-ui-"));
const bundle = await build({
  entryPoints: ["tests/offline/email-fixture.tsx"], bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_SUPABASE_URL": '""', "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": '""' },
  plugins: [{ name: "offline-next-boundaries", setup(builder) {
    builder.onResolve({ filter: /^next\/(navigation|link)$|^next-intl$/ }, (args) => ({ path: args.path, namespace: "offline" }));
    builder.onLoad({ filter: /.*/, namespace: "offline" }, (args) => ({
      loader: "jsx", resolveDir: cwd,
      contents: args.path === "next-intl"
        ? 'export { IntlProvider as NextIntlClientProvider, useTranslations, useFormatter, useLocale } from "use-intl";'
        : args.path === "next/link" ? 'import React from "react"; export default function Link({href,children,...props}) { return <a href={href} {...props}>{children}</a> }'
          : 'export const usePathname=()=>"/email"; export const useSearchParams=()=>new URLSearchParams(); export const useRouter=()=>({push(){},replace(){},refresh(){}});',
    }));
  } }],
});
const cssFiles = existsSync(".next/static") ? readdirSync(".next/static", { recursive: true }).filter((file) => file.endsWith(".css")) : [];
if (!cssFiles.length) throw new Error("Run npm run build first; the browser check requires the application's real CSS.");
const css = cssFiles.map((file) => readFileSync(path.join(".next/static", file), "utf8")).join("\n");
const accountId = "11111111-1111-4111-8111-111111111111";
const account = { id: accountId, label: "Sales", email: "sales@example.com", provider: "custom", username: "sales", smtpHost: "smtp.example.com", smtpPort: 465, smtpSecure: true, imapHost: "imap.example.com", imapPort: 993, imapSecure: true, color: "#004F7C", enabled: true, lastSyncAt: null, updatedAt: "2026-11-19T12:00:00Z" };
const requests = [];
let delayedResponse;
const title = readFileSync("src/lib/crm/email/__tests__/subject.test.ts", "utf8").match(/const title = "(.*)";/)[1];
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/app.js") { res.setHeader("Content-Type", "text/javascript; charset=utf-8"); res.end(bundle.outputFiles[0].text); return; }
  if (url.pathname === "/style.css") { res.setHeader("Content-Type", "text/css; charset=utf-8"); res.end(css); return; }
  if (!url.pathname.startsWith("/api/")) { res.setHeader("Content-Type", "text/html; charset=utf-8"); res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/app.js"></script>'); return; }
  requests.push(url.pathname);
  res.setHeader("Content-Type", "application/json");
  let data;
  if (url.pathname.endsWith("/accounts")) data = { accounts: [account], nextCursor: null };
  else if (url.pathname.endsWith("/presets")) data = { presets: [] };
  else if (url.pathname.endsWith("/sync")) data = { items: [], nextUid: 99, synced: 0 };
  else if (url.pathname.endsWith("/matches")) data = { matches: [] };
  else if (url.pathname.endsWith("/flags")) data = {};
  else if (url.pathname === "/api/crm/cases/report") data = { total: 3, open: 1, resolved: 2, breached: 0, avgResolutionMinutes: 120 };
  else if (url.pathname.endsWith("/message")) {
    if (url.searchParams.get("uid") === "43") { delayedResponse = res; return; }
    data = { headerId: `${accountId}:Sent:${url.searchParams.get("uid")}`, accountId, subject: title, text: "Server body", html: "", references: [], attachments: [] };
  }
  else { res.statusCode = 501; data = { error: "Unexpected offline API request" }; }
  res.end(JSON.stringify(data));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(existsSync(edge) ? { executablePath: edge } : {}) });
  // Deliberately differ from the CRM's locale and UTC timezone.
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: "de-DE", timezoneId: "America/Sao_Paulo", acceptDownloads: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const row = (subject) => page.getByRole("button").filter({ has: page.locator("p", { hasText: subject }) });
  await expect(row("Shared sent")).toHaveCount(1);
  await expect(row("Local only")).toHaveCount(1);
  await expect(row("Other account secret")).toHaveCount(0);
  await expect(row("Unowned legacy secret")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Local sent" })).toHaveCount(0);
  const isolation = await page.evaluate(() => window.emailAudit.isolation());
  expect(Object.values(isolation.counts).every((count) => count === 0)).toBe(true);
  expect(isolation.aliceSent).toBe(3);
  expect(isolation.aliceDrafts).toBe(1);
  await row("Local only").click();
  await expect(page.getByText("Local body saved on this device", { exact: true })).toBeVisible();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: /quote\.pdf/ }).click();
  const download = await downloadEvent;
  const downloadedFile = path.join(scratch, "quote.pdf");
  await download.saveAs(downloadedFile);
  expect(readFileSync(downloadedFile, "utf8")).toBe("quote123");
  expect(requests.some((url) => url.endsWith("/attachment"))).toBe(false);
  const garbled = await page.evaluate(() => window.emailAudit.garbled);
  await row(garbled).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await row("Remote only").click();
  await expect.poll(() => Boolean(delayedResponse)).toBe(true);
  await row(title).click();
  await expect(page.getByText("Server body", { exact: true })).toBeVisible();
  const lateResponse = page.waitForResponse((response) => response.url().includes("/message?") && new URL(response.url()).searchParams.get("uid") === "43");
  delayedResponse.end(JSON.stringify({ headerId: `${accountId}:Sent:43`, accountId, subject: "Remote only", text: "Stale wrong body", html: "", references: [], attachments: [] }));
  await (await lateResponse).finished();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(page.getByText("Stale wrong body", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear local copies" }).click();
  await expect(row("Local only")).toHaveCount(0);
  await expect(row("Shared sent")).toHaveCount(1);
  await page.setViewportSize({ width: 375, height: 812 });
  await row(title).click();
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: path.join(scratch, "email-375.png"), fullPage: true });
  for (const locale of ["en", "pt-BR", "es", "zh-CN"]) {
    const messages = JSON.parse(readFileSync(`messages/${locale}/email.json`, "utf8"));
    await page.evaluate((locale) => window.emailAudit.setLocale(locale), locale);
    const date = new Date("2026-11-19T10:39:00Z");
    const normalize = (value) => value.replace(/\s/g, " ");
    await expect.poll(async () => normalize(await row(title).locator("time").innerText())).toBe(normalize(new Intl.DateTimeFormat(locale, { timeZone: "UTC", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date)));
    await expect.poll(async () => normalize(await page.locator("time").last().innerText())).toBe(normalize(new Intl.DateTimeFormat(locale, { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }).format(date)));
    await expect(page.getByRole("region", { name: "Case summary" }).locator("strong")).toHaveText(new Intl.NumberFormat(locale, { style: "unit", unit: "hour", unitDisplay: "short", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(2));
    await page.getByRole("button", { name: messages.actions.compose, exact: true }).click();
    const dialog = page.getByRole("dialog");
    const template = dialog.locator("select").first();
    await expect(template.locator('option[value="quotation"]')).toHaveText(messages.templates.quotation.name);
    await expect(template.locator('option[value="private-template"]')).toHaveText("Alice template");
    await template.selectOption("quotation");
    await expect(dialog.locator('input:not([type="file"])').nth(2)).toHaveValue(messages.templates.quotation.subject);
    await expect(dialog.locator("textarea")).toHaveValue(messages.templates.quotation.body);
    await template.selectOption("private-template");
    await expect(dialog.locator("textarea")).toHaveValue("Alice secret");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
  await page.screenshot({ path: path.join(scratch, "email-zh-375.png"), fullPage: true });
  await page.evaluate(() => window.emailAudit.switchUser());
  await expect(row("Shared sent")).toHaveCount(0);
  await expect(page.getByText("Alice draft", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => window.emailAudit.closedHandleRejects())).toBe(true);
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ passed: true, checks: ["sent dedup", "local attachment bytes", "legacy title refresh", "out-of-order body requests", "account filtering", "all stores scoped to user", "clear cannot delete other user", "user switch removes old UI", "closed handles reject delayed writes", "four-locale templates and saved custom content", "four-locale email dates and case durations", "375px overflow in four locales"], screenshot: path.join(scratch, "email-zh-375.png") }));
} finally {
  await browser?.close();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
