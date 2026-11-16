# Inbound leads API

The website (Oboya_Website) forwards contact-form and RFQ submissions to the CRM. The endpoint has no user session: it authenticates the caller with an HMAC signature and writes with the service role.

- **URL:** `POST https://crm.oboya-horticulture.com/api/inbound/leads` (dev: `http://localhost:3000/api/inbound/leads`)
- **Code:** `src/app/api/inbound/leads/route.ts` (orchestration), `src/lib/crm/inbound/{signature,schema,map}.ts` (pure logic, tests in `src/lib/crm/inbound/__tests__`)
- **Secret:** `INBOUND_LEADS_SECRET`, shared with the website, server-only on both sides. If it is not set the endpoint returns `503`.

## Request

| Header | Required | Value |
|---|---|---|
| `Content-Type` | yes | `application/json` |
| `X-Oboya-Signature` | yes | `t=<unix seconds>,v1=<hex HMAC-SHA256(secret, t + "." + rawBody)>` |
| `Idempotency-Key` | no | 1–200 printable ASCII characters, no spaces (e.g. the website submission id) |

The body is limited to **64 KB** (`413` above it).

### Signing

1. Serialize the payload once and keep the exact bytes (`rawBody`). Do not re-serialize after signing.
2. `t` = current Unix time in seconds.
3. `v1` = lowercase hex of `HMAC-SHA256(key = secret, message = t + "." + rawBody)`. The CRM computes it over the exact bytes it receives (`t + "."` then the raw body bytes), then decodes the body as strict UTF-8: a body that is not valid UTF-8 gets `400`.
4. Send `X-Oboya-Signature: t=<t>,v1=<v1>`.

The CRM accepts `|now − t| ≤ 300 s` and compares in constant time. Several `v1=` values may be sent (useful while rotating the secret); any match is accepted. Unknown keys in the header are ignored.

**Node**

```ts
import { createHmac } from "node:crypto";

const rawBody = JSON.stringify(payload);
const t = Math.floor(Date.now() / 1000);
const v1 = createHmac("sha256", process.env.INBOUND_LEADS_SECRET!).update(`${t}.${rawBody}`).digest("hex");

const res = await fetch(`${process.env.CRM_URL}/api/inbound/leads`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Oboya-Signature": `t=${t},v1=${v1}`,
    "Idempotency-Key": submissionId,
  },
  body: rawBody,
});
```

**PHP**

```php
$rawBody = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
$t = time();
$v1 = hash_hmac('sha256', $t . '.' . $rawBody, getenv('INBOUND_LEADS_SECRET'));
$ch = curl_init('https://crm.oboya-horticulture.com/api/inbound/leads');
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_POSTFIELDS => $rawBody,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => [
    'Content-Type: application/json',
    "X-Oboya-Signature: t=$t,v1=$v1",
  ],
]);
$response = curl_exec($ch);
```

**curl (shell)**

```bash
BODY=$(cat payload.json); T=$(date +%s)
SIG=$(printf '%s' "$T.$BODY" | openssl dgst -sha256 -hmac "$INBOUND_LEADS_SECRET" -hex | sed 's/^.* //')
curl -X POST http://localhost:3000/api/inbound/leads \
  -H 'Content-Type: application/json' -H "X-Oboya-Signature: t=$T,v1=$SIG" \
  --data-binary "$BODY"
```

Or let the helper print the command (the secret is read from env and never printed):

```bash
INBOUND_LEADS_SECRET=… node scripts/inbound-sign.mjs payload.json [url] [idempotency-key]
```

## Payloads

A JSON object discriminated by `type`. Field names and limits match the website routes (`src/app/api/cms/forms/route.ts`, `src/app/api/shop/rfq/route.ts`). Strings are trimmed; unknown keys are dropped.

### Common fields (both types)

| Field | Type | Required | Notes |
|---|---|---|---|
| `type` | `"contact"` \| `"quote"` | yes | discriminator |
| `email` | string ≤ 254 | yes | same pattern as the website's `isValidEmail` |
| `privacyAccepted` | `true` | yes | anything else is rejected |
| `marketingOptIn` | boolean | no | kept in `raw_payload` |
| `locale` | string ≤ 16 (BCP 47, e.g. `pt-BR`) | no | stored on the lead |
| `submittedAt` | ISO 8601 date-time with offset | no | kept in `raw_payload` / activity meta |
| `entity` | group company id or slug of its name (`oboya-horticulture`, `oboya-horticultura`, `oboya-reciclagem`) | no | default Oboya Horticulture; unknown → `400` |
| `source` | `[a-z0-9_]{1,40}` (a `lead_source` picklist value) | no | overrides `website_contact` / `website_rfq` |

### `type: "contact"` (website contact form)

| Field | Type | Required | Limit |
|---|---|---|---|
| `firstName` | string | yes | 80 |
| `lastName` | string | yes | 80 |
| `phone` | string | no | 32 |
| `countryCode` | ISO alpha-2 or `OTHER` | yes | |
| `countryName` | string | no | 120 |
| `company` | string | no | 120 |
| `subject` | string | yes | 50 |
| `message` | string | yes | 500 |

### `type: "quote"` (shop RFQ)

| Field | Type | Required | Limit |
|---|---|---|---|
| `referenceId` | string `[A-Za-z0-9][A-Za-z0-9_.:-]*` | yes | 80; the website's RFQ reference |
| `company` | string | yes | 120 |
| `contactName` | string | yes | 120 |
| `phone` | string | yes | 32 |
| `country` | string (display name) | no | 120 |
| `countryCode` | ISO alpha-2 or `OTHER` | yes | |
| `currency` | ISO 4217 (3 letters) | yes | |
| `message` | string | no | 500 |
| `officeId` | string | no | 80 |
| `items` | array of items | yes | 1–50 (website `ITEMS_MAX`) |
| `total` | number \| null | no | |
| `pricing` | string | no | 40 |

Item (the website's validated line):

| Field | Type | Required | Notes |
|---|---|---|---|
| `sku` | string ≤ 80 | yes | |
| `quantity` (or `qty`) | integer 1–999 999 | yes | website `MAX_QUANTITY` |
| `name` | string ≤ 200 | no | |
| `productId`, `variantId` | string ≤ 80 | no | |
| `variantName` | string ≤ 120 | no | |
| `unit`, `saleMode` | string ≤ 20 | no | |
| `unitPrice`, `lineTotal` | number ≥ 0 \| null | no | |

### Example

```json
{
  "type": "quote",
  "referenceId": "BR-2026-0042",
  "company": "Green BV",
  "contactName": "Jan van der Berg",
  "email": "jan@green.nl",
  "phone": "+31 6 1234 5678",
  "country": "Netherlands",
  "countryCode": "NL",
  "currency": "EUR",
  "message": "Delivery before March",
  "items": [{ "sku": "POT-12", "name": "Pot 12cm", "quantity": 500 }],
  "privacyAccepted": true,
  "locale": "en",
  "submittedAt": "2026-11-16T09:30:00Z"
}
```

## Mapping to a lead

| Lead column | Contact | Quote |
|---|---|---|
| `first_name` / `last_name` | `firstName` / `lastName` | `contactName` split: first word → first name, rest → last name (`Jan van der Berg` → `Jan` / `van der Berg`); a single word becomes the last name |
| `company`, `email`, `phone` | as sent | as sent |
| `country_code` | `countryCode` (`OTHER` → null) | same |
| `locale` | `locale` | `locale` |
| `message` | `"<subject> — <message>"` | `"RFQ <referenceId> · <currency>"`, the message, then `Items (n):` with one `- SKU × qty — name` line per item |
| `source` | `website_contact` | `website_rfq` |
| `external_ref` | `idem:<Idempotency-Key>` or null | `rfq:<referenceId>` |
| `raw_payload` | validated payload | validated payload |
| `entity_id` | `entity` or Oboya Horticulture | same |
| `status`, `owner_id` | `new`, assigned owner (below) | same |

## Responses

| Status | Body | When |
|---|---|---|
| `201` | `{ "leadId": "…" }` | new lead created |
| `200` | `{ "leadId": "…", "deduplicated": true }` | email matched an open lead; a note was added |
| `200` | `{ "contactId": "…", "deduplicated": true }` | email matched a converted lead; the note went to its contact |
| `200` | original ids + `"replayed": true` | idempotency key already processed; nothing written |
| `400` | `{ "error": "Invalid encoding" }` | signed body is not valid UTF-8 |
| `400` | `{ "error": "Invalid JSON" }` or `{ "error": "Invalid payload", "issues": [{ "path": "items", "code": "too_big" }] }` | bad JSON, schema failure, unknown `entity`, bad `Idempotency-Key`. Issues carry paths and codes only, never values |
| `401` | `{ "error": "Unauthorized" }` | signature missing, malformed, expired or wrong (no detail on purpose) |
| `413` | `{ "error": "Payload too large" }` | body > 64 KB |
| `500` | `{ "error": "Internal error" }` | database failure; safe to retry with the same key |
| `503` | `{ "error": "Service unavailable" }` | `INBOUND_LEADS_SECRET` or the service role key is not configured |

The website should retry on `5xx` and network errors (with backoff, same body, same `Idempotency-Key`, fresh signature) and never retry `4xx`.

## Dedupe

Matched on `lower(email)` among non-deleted leads (the same key as the `crm_leads_email_live_uq` index):

- **Open lead** (not converted, any status): a `note` activity (status `done`) is added to the lead with a summary of the submission, `meta = { inbound, type, source, referenceId?, idempotencyKey?, locale?, submittedAt? }` and `external_ref` = the idempotency key. The lead's `last_activity_at` is bumped. The lead's fields are **not** overwritten. Owner of the note = lead owner.
- **Converted lead:** the note goes to the converted contact (`what_object = 'contact'`, `who_contact_id` = the contact, owner = contact owner). If that contact was deleted, the note goes to the lead.
- **No match:** a new lead is created.

Contacts and accounts are not matched directly. Concurrent requests for the same email are resolved by the unique index: the loser re-runs once and lands on the dedupe path.

## Idempotency

The key is the `Idempotency-Key` header (stored as `idem:<key>`), and for quotes also `rfq:<referenceId>`.

- A new lead stores the primary key in `crm_leads.external_ref`: `rfq:<referenceId>` for quotes, `idem:<key>` for contacts.
- A dedupe note stores it in `crm_activities.external_ref`, and the header key in `meta.idempotencyKey`.
- `crm_leads.external_ref` is unique among non-deleted leads only. A key that matches only a soft-deleted lead is not a replay: the submission is processed as new.
- Before doing anything, the endpoint looks for any of the keys on a live (non-deleted) lead `external_ref`, an activity `external_ref` or an activity `meta.idempotencyKey`. On a hit it returns `200` with the original ids and `replayed: true` and writes nothing.
- A contact sent without `Idempotency-Key` has no idempotency: a retry adds another note to the same lead. The website should always send its submission id.

## Owner assignment (D3)

New leads get `owner_id = rpc('crm_assign_inbound_owner')` (service role only). Setup → Lead assignment (`crm_settings.inbound_assignment.mode`) chooses:

- `round_robin` (default): the next active user with write access flagged `receives_inbound`, ordered by id, cursor in `crm_settings.inbound_rr_cursor` under a row lock;
- `default_owner`: `crm_settings.inbound_default_owner`.

When nobody is flagged, the default owner is used, then the oldest active super admin. Repeat submissions do not reassign: the note goes to the existing owner.

## Website integration (to do on the website; not part of the CRM)

1. Add server-only env vars `CRM_INBOUND_URL` and `INBOUND_LEADS_SECRET` (same value as the CRM) to the website project.
2. In `src/app/api/cms/forms/route.ts` `POST`, after `addFormSubmissionDurable` succeeds, send `{ type: "contact", firstName, lastName, email, phone, countryCode, countryName, company, subject, message, privacyAccepted: true, marketingOptIn, locale, submittedAt: acceptedAt }` with `Idempotency-Key: <submission.id>`.
3. In `src/app/api/shop/rfq/route.ts` `POST`, after `addQuoteSubmissionWithReference`, send `{ type: "quote", referenceId, company, contactName, email, phone, country, countryCode, currency, message, officeId, items: validatedItems, total, pricing, privacyAccepted: true, marketingOptIn, locale, submittedAt }`.
4. Forward without blocking the visitor's response (e.g. `after()` or a queue), with a short timeout. Log failures and keep the submission flagged for retry (cron or admin "resend to CRM"); retries reuse the same body and key with a fresh signature.
5. Do not send the IP hash or other `meta`/`context`; they are stripped anyway.
6. **Never relay the CRM response body to the website visitor.** Show the visitor the website's own confirmation; CRM ids and errors stay server-side (logs only).
