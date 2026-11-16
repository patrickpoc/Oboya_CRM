import { defineConfig, devices } from "@playwright/test";

// Port 3100 so the smoke run never collides with `next dev` on 3000.
// The server uses the real Supabase env from .env.local (the smoke flow logs in
// as the seeded demo rep), so run it only against a demo/test project.
const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    locale: "en-US",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run build && npm run start -- --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/login`,
    // PW_REUSE_SERVER=1 reuses a server already on 3100 (faster local iteration).
    reuseExistingServer: process.env.PW_REUSE_SERVER === "1",
    timeout: 300_000,
    env: {
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
