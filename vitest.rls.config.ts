// RLS suite: real user JWTs against the Supabase project in
// NEXT_PUBLIC_SUPABASE_URL (or RLS_TEST_SUPABASE_URL). Needs the demo seed.
// Run with `npm run test:rls`; `npm test` (vitest.config.ts) never includes it.
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/rls/**/*.test.ts"],
    globalSetup: ["tests/rls/global-setup.ts"],
    // One shared fixture set: run files one after another.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./tests/support/server-only.ts"),
    },
  },
});
