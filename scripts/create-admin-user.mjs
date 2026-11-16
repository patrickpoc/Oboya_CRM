// Creates (or resets) a super_admin for the CRM.
// Usage: ADMIN_EMAIL=you@company.com ADMIN_PASSWORD='...' npm run create-admin
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the env,
// .env.local or .env. Ported from the Oboya_Website reference script.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile(filename) {
  const filePath = path.join(rootDir, filename);
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const name = process.env.ADMIN_NAME ?? "Oboya CRM Admin";

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
if (!email || !email.includes("@")) {
  console.error("Set ADMIN_EMAIL.");
  process.exit(1);
}
if (!password || password.length < 8) {
  console.error("Set ADMIN_PASSWORD (min 8 characters). Do not use a shared default.");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findUserByEmail(target) {
  for (let page = 1; page < 50; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Failed to list users: ${error.message}`);
    const hit = data.users.find((user) => user.email?.toLowerCase() === target);
    if (hit) return hit;
    if (data.users.length < 1000) return null;
  }
  return null;
}

const existing = await findUserByEmail(email);
let userId;

if (existing) {
  const { error } = await supabase.auth.admin.updateUserById(existing.id, {
    password,
    email_confirm: true,
    user_metadata: { ...existing.user_metadata, full_name: name },
    app_metadata: { ...existing.app_metadata, must_change_password: process.env.ADMIN_MUST_CHANGE_PASSWORD === "1" },
  });
  if (error) {
    console.error("Failed to update admin user:", error.message);
    process.exit(1);
  }
  userId = existing.id;
  console.log(`Admin user already exists. Password reset for ${email}`);
} else {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
    app_metadata: { must_change_password: process.env.ADMIN_MUST_CHANGE_PASSWORD === "1" },
  });
  if (error || !data.user) {
    console.error("Failed to create admin user:", error?.message || "Unknown error");
    process.exit(1);
  }
  userId = data.user.id;
  console.log(`Created admin user ${email}`);
}

// handle_new_user already inserted a crm_users row; promote it.
const { error: profileError } = await supabase.from("crm_users").upsert(
  {
    id: userId,
    email,
    full_name: name,
    role: "super_admin",
    status: "active",
    locale: "en",
  },
  { onConflict: "id" },
);

if (profileError) {
  console.error("Failed to upsert crm_users:", profileError.message);
  console.error("Apply supabase/migrations/* first (see docs/SUPABASE.md).");
  process.exit(1);
}

console.log(`Email: ${email}`);
console.log("Role: super_admin (status active). Password not printed.");
