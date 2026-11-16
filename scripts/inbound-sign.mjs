#!/usr/bin/env node
// Prints a ready-to-run curl command for POST /api/inbound/leads with a fresh
// X-Oboya-Signature header for the given JSON file. The secret is read from
// INBOUND_LEADS_SECRET and is never printed.
//
//   INBOUND_LEADS_SECRET=… node scripts/inbound-sign.mjs payload.json [url] [idempotency-key]
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const [file, url = "http://localhost:3000/api/inbound/leads", idempotencyKey] = process.argv.slice(2);
const secret = process.env.INBOUND_LEADS_SECRET?.trim();
if (!file) {
  console.error("usage: node scripts/inbound-sign.mjs <payload.json> [url] [idempotency-key]");
  process.exit(1);
}
if (!secret) {
  console.error("INBOUND_LEADS_SECRET is not set");
  process.exit(1);
}

// Sign the exact bytes that will be sent (--data-binary @file).
const body = readFileSync(file, "utf8");
const t = Math.floor(Date.now() / 1000);
const v1 = createHmac("sha256", secret).update(`${t}.${body}`, "utf8").digest("hex");
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

const lines = [
  `curl -sS -X POST ${q(url)}`,
  `  -H 'Content-Type: application/json'`,
  `  -H ${q(`X-Oboya-Signature: t=${t},v1=${v1}`)}`,
  ...(idempotencyKey ? [`  -H ${q(`Idempotency-Key: ${idempotencyKey}`)}`] : []),
  `  --data-binary @${q(file)}`,
];
console.log(lines.join(" \\\n"));
console.error("(signature valid for 5 minutes)");
