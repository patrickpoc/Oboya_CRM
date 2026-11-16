// Loads .env.local / .env into process.env (without overriding values already
// set) for the RLS and e2e suites. Values are never printed.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const rootDir = path.resolve(__dirname, "..", "..");

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  for (const filename of [".env.local", ".env"]) {
    const filePath = path.join(rootDir, filename);
    if (!existsSync(filePath)) continue;
    for (const line of readFileSync(filePath, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator === -1) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed
        .slice(separator + 1)
        .trim()
        .replace(/^(['"])(.*)\1$/, "$2");
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

/** First non-empty env var among `names`; throws (naming the vars, never values) when none is set. */
export function requireEnv(...names: string[]): string {
  loadEnv();
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  throw new Error(`Missing env: set one of ${names.join(", ")}`);
}

export interface TestEnv {
  url: string;
  anonKey: string;
  serviceKey: string;
  demoPassword: string;
}

// Test-only secrets: RLS_TEST_* wins over the app env so a dedicated test
// project can be targeted without touching .env.local.
export function testEnv(): TestEnv {
  return {
    url: requireEnv("RLS_TEST_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"),
    anonKey: requireEnv("RLS_TEST_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    serviceKey: requireEnv("RLS_TEST_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
    demoPassword: requireEnv("RLS_TEST_DEMO_PASSWORD", "DEMO_PASSWORD"),
  };
}

export const DEMO_EMAILS = {
  lucas: "demo.lucas.pereira@example.com",
  camila: "demo.camila.rocha@example.com",
  pieter: "demo.pieter.bakker@example.com",
  ricardo: "demo.ricardo.souza@example.com",
  sanne: "demo.sanne.de.vries@example.com",
  wei: "demo.wei.zhang@example.com",
} as const;

export type DemoKey = keyof typeof DEMO_EMAILS;
