import { describe, expect, it } from "vitest";
import en from "../../../../../messages/en/email.json";
import pt from "../../../../../messages/pt-BR/email.json";
import es from "../../../../../messages/es/email.json";
import zh from "../../../../../messages/zh-CN/email.json";
import { mergeEmailTemplates } from "../templates";
import type { EmailTemplate } from "../local-db";

const defaults = (messages: typeof en): EmailTemplate[] => [
  { id: "follow-up", ...messages.templates.followUp, updatedAt: new Date(0).toISOString() },
  { id: "quotation", ...messages.templates.quotation, updatedAt: new Date(0).toISOString() },
];

describe("localized email templates", () => {
  it.each([["en", en], ["pt-BR", pt], ["es", es], ["zh-CN", zh]] as const)(
    "uses current %s defaults when the database still contains original English seeds",
    (_locale, messages) => {
      const stored = defaults(en);
      const snapshot = structuredClone(stored);
      expect(mergeEmailTemplates(stored, defaults(messages))).toEqual(defaults(messages));
      expect(stored).toEqual(snapshot);
      expect(messages.templates.followUp.body.split("\n\n")).toHaveLength(3);
      expect(messages.templates.quotation.body.split("\n\n")).toHaveLength(3);
    }
  );

  it("preserves customized built-ins and user templates across language changes without persisting defaults", () => {
    const customized = { ...defaults(en)[0], body: "Customer-specific wording", updatedAt: "2026-11-19T12:00:00Z" };
    const user = { id: "custom", name: "My template", subject: "My subject", body: "My body", updatedAt: "2026-11-19T12:00:00Z" };
    const stored = [customized, user];
    const snapshot = structuredClone(stored);
    for (const messages of [en, pt, es, zh]) {
      expect(mergeEmailTemplates(stored, defaults(messages))).toEqual([defaults(messages)[1], customized, user]);
      expect(stored).toEqual(snapshot);
    }
  });

  it("keeps saved copies even when their text matches a seed but their saved timestamp differs", () => {
    const saved = { ...defaults(en)[1], updatedAt: "2026-11-19T12:00:00Z" };
    expect(mergeEmailTemplates([saved], defaults(zh))).toEqual([defaults(zh)[0], saved]);
  });
});
