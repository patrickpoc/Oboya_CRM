import { describe, expect, it } from "vitest";
import {
  computeSignature,
  decodeUtf8Strict,
  parseSignatureHeader,
  signatureHeader,
  verifySignature,
} from "../signature";
import { parseInboundPayload, type QuotePayload } from "../schema";
import {
  DEFAULT_ENTITY_ID,
  deriveIdempotencyKeys,
  isInvalidIdempotencyHeader,
  mapToActivityNote,
  mapToLead,
  resolveEntityId,
  splitContactName,
  summarizeItems,
} from "../map";

const SECRET = "test-secret";
const NOW = 1_800_000_000;

const contact = {
  type: "contact",
  firstName: "Ana",
  lastName: "Souza",
  email: "Ana@Example.com",
  phone: "+55 11 99999-0000",
  countryCode: "BR",
  countryName: "Brazil",
  company: "Flores Ltda",
  subject: "Pots",
  message: "Need 10k pots",
  privacyAccepted: true,
};

const quote = {
  type: "quote",
  referenceId: "BR-2026-0042",
  company: "Green BV",
  contactName: "Jan van der Berg",
  email: "jan@green.nl",
  phone: "+31 6 1234",
  country: "Netherlands",
  countryCode: "NL",
  currency: "eur",
  message: "Urgent",
  items: [
    { sku: "POT-12", name: "Pot 12cm", quantity: 500 },
    { sku: "TRAY-1", qty: 20, unit: "box" },
  ],
  privacyAccepted: true,
};

describe("signature", () => {
  const body = JSON.stringify(contact);

  it("accepts a valid signature", () => {
    const header = signatureHeader(SECRET, body, NOW);
    expect(verifySignature(SECRET, header, body, NOW)).toEqual({ ok: true, timestamp: NOW });
  });

  it("accepts within tolerance and rejects expired / future timestamps", () => {
    expect(verifySignature(SECRET, signatureHeader(SECRET, body, NOW - 300), body, NOW).ok).toBe(true);
    expect(verifySignature(SECRET, signatureHeader(SECRET, body, NOW - 301), body, NOW)).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(verifySignature(SECRET, signatureHeader(SECRET, body, NOW + 301), body, NOW).ok).toBe(false);
  });

  it("rejects a tampered body or wrong secret", () => {
    const header = signatureHeader(SECRET, body, NOW);
    expect(verifySignature(SECRET, header, body.replace("Ana", "Eve"), NOW).ok).toBe(false);
    expect(verifySignature("other", header, body, NOW)).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects missing and malformed headers", () => {
    expect(verifySignature(SECRET, null, body, NOW)).toEqual({ ok: false, reason: "missing" });
    for (const header of ["garbage", `t=${NOW}`, "v1=abc", `t=abc,v1=${"a".repeat(64)}`, `t=${NOW},v1=xyz`, `t=${NOW},v1=${"a".repeat(63)}`]) {
      expect(verifySignature(SECRET, header, body, NOW)).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("signs the raw bytes: t + '.' then the body", () => {
    const bytes = Buffer.from(body, "utf8");
    expect(computeSignature(SECRET, NOW, bytes)).toBe(computeSignature(SECRET, NOW, body));
    expect(verifySignature(SECRET, signatureHeader(SECRET, body, NOW), bytes, NOW).ok).toBe(true);
  });

  it("does not let invalid UTF-8 verify as its decoded replacement text", () => {
    const invalid = Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]); // {"a":"\xff"}
    const decoded = invalid.toString("utf8"); // lossy: U+FFFD
    const header = signatureHeader(SECRET, decoded, NOW);
    expect(verifySignature(SECRET, header, invalid, NOW)).toEqual({ ok: false, reason: "mismatch" });
    expect(verifySignature(SECRET, signatureHeader(SECRET, invalid, NOW), invalid, NOW).ok).toBe(true);
  });

  it("decodes UTF-8 strictly", () => {
    expect(decodeUtf8Strict(Buffer.from('{"n":"São"}', "utf8"))).toBe('{"n":"São"}');
    expect(decodeUtf8Strict(Buffer.from([0x22, 0xc3, 0x28, 0x22]))).toBeNull();
  });

  it("parses multiple v1 values and matches any", () => {
    const good = computeSignature(SECRET, NOW, body);
    const header = `t=${NOW},v1=${"0".repeat(64)},v1=${good}`;
    expect(parseSignatureHeader(header)?.v1).toHaveLength(2);
    expect(verifySignature(SECRET, header, body, NOW).ok).toBe(true);
  });
});

describe("schema", () => {
  it("accepts a contact payload", () => {
    const result = parseInboundPayload({ ...contact, extra: "stripped" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).not.toHaveProperty("extra");
  });

  it("accepts a quote payload and normalises qty / currency", () => {
    const result = parseInboundPayload(quote);
    expect(result.ok).toBe(true);
    if (result.ok && result.data.type === "quote") {
      expect(result.data.currency).toBe("EUR");
      expect(result.data.items[1].quantity).toBe(20);
    }
  });

  it("requires privacyAccepted: true", () => {
    const result = parseInboundPayload({ ...contact, privacyAccepted: false });
    expect(result).toMatchObject({ ok: false, issues: [{ path: "privacyAccepted" }] });
    expect(parseInboundPayload({ ...quote, privacyAccepted: undefined }).ok).toBe(false);
  });

  it("caps RFQ items at 50", () => {
    const items = Array.from({ length: 51 }, (_, i) => ({ sku: `S${i}`, quantity: 1 }));
    expect(parseInboundPayload({ ...quote, items })).toMatchObject({ ok: false, issues: [{ path: "items" }] });
    expect(parseInboundPayload({ ...quote, items: items.slice(0, 50) }).ok).toBe(true);
  });

  it("rejects a bad email without echoing the value", () => {
    const result = parseInboundPayload({ ...contact, email: "not-an-email<script>" });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("script");
    expect(result).toMatchObject({ issues: [{ path: "email" }] });
  });

  it("enforces website limits and the discriminator", () => {
    expect(parseInboundPayload({ ...contact, subject: "x".repeat(51) }).ok).toBe(false);
    expect(parseInboundPayload({ ...contact, message: "x".repeat(501) }).ok).toBe(false);
    expect(parseInboundPayload({ ...contact, countryCode: "Brazil" }).ok).toBe(false);
    expect(parseInboundPayload({ ...quote, items: [{ sku: "A" }] }).ok).toBe(false);
    expect(parseInboundPayload({ ...contact, type: "other" }).ok).toBe(false);
  });
});

describe("mapping", () => {
  it("splits the contact name: first word / rest", () => {
    expect(splitContactName("  Jan   van der Berg ")).toEqual({ firstName: "Jan", lastName: "van der Berg" });
    expect(splitContactName("Madonna")).toEqual({ firstName: null, lastName: "Madonna" });
  });

  it("maps a contact to a lead", () => {
    const result = parseInboundPayload(contact);
    if (!result.ok) throw new Error("invalid");
    expect(mapToLead(result.data, null)).toMatchObject({
      first_name: "Ana",
      last_name: "Souza",
      company: "Flores Ltda",
      country_code: "BR",
      message: "Pots — Need 10k pots",
      source: "website_contact",
      external_ref: null,
    });
  });

  it("maps a quote with an items summary and OTHER country to null", () => {
    const result = parseInboundPayload({ ...quote, countryCode: "OTHER", source: "trade_show" });
    if (!result.ok) throw new Error("invalid");
    const lead = mapToLead(result.data, "rfq:BR-2026-0042");
    expect(lead).toMatchObject({
      first_name: "Jan",
      last_name: "van der Berg",
      country_code: null,
      source: "trade_show",
      external_ref: "rfq:BR-2026-0042",
    });
    expect(lead.message).toContain("RFQ BR-2026-0042 · EUR");
    expect(lead.raw_payload).toEqual(result.data);
  });

  it("summarises items", () => {
    const items = (parseInboundPayload(quote) as { ok: true; data: QuotePayload }).data.items;
    expect(summarizeItems(items)).toBe("Items (2):\n- POT-12 × 500 — Pot 12cm\n- TRAY-1 × 20 box");
  });

  it("builds the dedupe note with reference meta", () => {
    const result = parseInboundPayload(quote);
    if (!result.ok) throw new Error("invalid");
    const keys = deriveIdempotencyKeys("abc", result.data);
    const note = mapToActivityNote(result.data, keys);
    expect(note.subject).toBe("Website RFQ BR-2026-0042 (2 items)");
    expect(note.meta).toMatchObject({ referenceId: "BR-2026-0042", idempotencyKey: "idem:abc", source: "website_rfq" });
  });

  it("resolves the entity by id or slug, defaulting to Oboya Horticulture", () => {
    const entities = [
      { id: DEFAULT_ENTITY_ID, name: "Oboya Horticulture" },
      { id: "00000000-0000-4000-8000-000000000202", name: "Oboya Horticultura" },
    ];
    expect(resolveEntityId(undefined, entities)).toBe(DEFAULT_ENTITY_ID);
    expect(resolveEntityId("oboya-horticultura", entities)).toBe(entities[1].id);
    expect(resolveEntityId(entities[1].id.toUpperCase(), entities)).toBe(entities[1].id);
    expect(resolveEntityId("nope", entities)).toBeUndefined();
  });
});

describe("idempotency keys", () => {
  it("uses the header for contacts and rfq:<referenceId> for quotes", () => {
    const c = parseInboundPayload(contact);
    const q = parseInboundPayload(quote);
    if (!c.ok || !q.ok) throw new Error("invalid");
    expect(deriveIdempotencyKeys(null, c.data)).toEqual({ primary: null, header: null, all: [] });
    expect(deriveIdempotencyKeys(" k1 ", c.data)).toEqual({ primary: "idem:k1", header: "idem:k1", all: ["idem:k1"] });
    expect(deriveIdempotencyKeys(null, q.data).primary).toBe("rfq:BR-2026-0042");
    expect(deriveIdempotencyKeys("k1", q.data)).toEqual({
      primary: "rfq:BR-2026-0042",
      header: "idem:k1",
      all: ["rfq:BR-2026-0042", "idem:k1"],
    });
  });

  it("flags unusable headers", () => {
    expect(isInvalidIdempotencyHeader(null)).toBe(false);
    expect(isInvalidIdempotencyHeader("ok-123")).toBe(false);
    expect(isInvalidIdempotencyHeader("")).toBe(true);
    expect(isInvalidIdempotencyHeader("has space")).toBe(true);
    expect(isInvalidIdempotencyHeader("x".repeat(201))).toBe(true);
  });
});
