import type { EmailTemplate } from "./local-db";

// Fingerprints of the former, unedited English seeds. Customised copies and
// user-created templates must survive when built-ins follow the current locale.
const legacySeeds: EmailTemplate[] = [
  { id: "follow-up", name: "Follow up", subject: "Following up", body: "Hello,\n\nFollowing up on our conversation.\n\nBest regards", updatedAt: new Date(0).toISOString() },
  { id: "quotation", name: "Quotation", subject: "Quotation", body: "Hello,\n\nPlease find our quotation below.\n\nBest regards", updatedAt: new Date(0).toISOString() },
];

/** Defaults are translated at render time; saved user content is never rewritten. */
export function mergeEmailTemplates(stored: EmailTemplate[], defaults: EmailTemplate[]): EmailTemplate[] {
  const custom = stored.filter((template) => !legacySeeds.some((seed) =>
    seed.id === template.id && seed.name === template.name && seed.subject === template.subject &&
    seed.body === template.body && seed.updatedAt === template.updatedAt
  ));
  return [...defaults.filter((template) => !custom.some((saved) => saved.id === template.id)), ...custom];
}
