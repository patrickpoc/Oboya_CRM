import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import Dexie from "dexie";
import { NextIntlClientProvider } from "next-intl";
import { CrmProvider } from "../../src/contexts/CrmContext";
import { EmailView } from "../../src/components/crm/email/EmailView";
import { CaseReportBar } from "../../src/components/crm/cases/CaseReportBar";
import { CRM_MODULES, type CrmUser, type ResolvedPermissions } from "../../src/lib/crm/types";
import { emailDb, closeEmailDatabases, cacheHeaders, cacheBody, cacheAttachment, saveDraft, saveSentMessage, listDrafts, listSent, clearSentMessages } from "../../src/lib/crm/email/local-db";
import type { MailHeader } from "../../src/lib/crm/email/types";
import { MAIL_HEADER_VERSION } from "../../src/lib/crm/email/types";
import email from "../../messages/en/email.json";
import cases from "../../messages/en/cases.json";
import shell from "../../messages/en/shell.json";
import ptEmail from "../../messages/pt-BR/email.json";
import ptCases from "../../messages/pt-BR/cases.json";
import ptShell from "../../messages/pt-BR/shell.json";
import esEmail from "../../messages/es/email.json";
import esCases from "../../messages/es/cases.json";
import esShell from "../../messages/es/shell.json";
import zhEmail from "../../messages/zh-CN/email.json";
import zhCases from "../../messages/zh-CN/cases.json";
import zhShell from "../../messages/zh-CN/shell.json";

const catalogs = {
  en: { email, cases, shell },
  "pt-BR": { email: ptEmail, cases: ptCases, shell: ptShell },
  es: { email: esEmail, cases: esCases, shell: esShell },
  "zh-CN": { email: zhEmail, cases: zhCases, shell: zhShell },
};

const alice = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const bob = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const accountId = "11111111-1111-4111-8111-111111111111";
const title = "AI 会议统计分析报告（2026-11-09 至 2026-11-15）";
const garbled = new TextDecoder("gb18030").decode(new TextEncoder().encode(title));
const db = emailDb(alice);
const header = (uid: number, subject: string, messageId: string): MailHeader => ({
  id: `${accountId}:Sent:${uid}`, accountId, folder: "Sent", uid, subject, messageId, headerVersion: MAIL_HEADER_VERSION,
  from: [{ name: "Sales", address: "sales@example.com" }], to: [{ name: "Buyer", address: "buyer@example.com" }], cc: [],
  date: `2026-11-19T10:${uid % 60}:00Z`, seen: true, flagged: false, answered: false, hasAttachments: false, attachments: [],
});
const local = {
  accountId, accountLabel: "Sales", from: "sales@example.com", to: ["buyer@example.com"], cc: [],
  text: "Local body saved on this device", html: "", date: "2026-11-19T12:00:00Z", bytes: 8,
  attachments: [{ id: "quote", filename: "quote.pdf", contentType: "application/pdf", size: 8, blob: new Blob(["quote123"]) }],
};
// A shared legacy cache cannot safely be attributed to either signed-in user.
const legacy = new Dexie("oboya-email");
legacy.version(2).stores({ sent: "id" });
await legacy.table("sent").put({ ...local, id: "unowned-legacy", subject: "Unowned legacy secret" });
legacy.close();
await cacheHeaders(db, accountId, "Sent", [header(42, "Shared sent", "<shared@example.com>"), header(43, "Remote only", "<remote@example.com>"), header(99, garbled, "<legacy@example.com>")], 99);
await saveSentMessage(db, { ...local, id: "shared", subject: "Shared sent", messageId: "<shared@example.com>" });
await saveSentMessage(db, { ...local, id: "local-only", subject: "Local only", messageId: "<local@example.com>" });
await saveSentMessage(db, { ...local, accountId: "unavailable-account", id: "private", subject: "Other account secret" });
await saveDraft(db, { id: "private-draft", accountId, to: [], cc: [], subject: "Alice draft", text: "Alice secret", html: "", updatedAt: "2026-11-19T12:00:00Z", synced: false });
await cacheBody(db, { headerId: "private-body", accountId, subject: "Alice body", text: "Alice secret", html: "", attachments: [] });
await cacheAttachment(db, { key: "private-attachment", headerId: "private-body", part: "1", filename: "private.pdf", contentType: "application/pdf", blob: new Blob(["Alice secret"]), cachedAt: "2026-11-19T12:00:00Z" });
await db.contacts.put({ id: "private-contact", recordType: "contact", email: "alice@example.com", fullName: "Private contact", accountId: null, accountName: null, cachedAt: "2026-11-19T12:00:00Z" });
await db.templates.put({ id: "private-template", name: "Alice template", subject: "Alice secret", body: "Alice secret", updatedAt: "2026-11-19T12:00:00Z" });

const permissions = Object.fromEntries(CRM_MODULES.map((module) => [module, module === "email" ? ["view", "create", "edit", "delete"] : []])) as ResolvedPermissions;
function user(id: string): CrmUser {
  return { id, email: `${id}@example.com`, fullName: "Offline tester", role: "sales_rep", roleLabel: "Sales", visibilityScope: "own", canWrite: true, teamId: null, locale: "en", permissionOverrides: {}, mustChangePassword: false };
}

function Fixture() {
  const [userId, setUserId] = useState(alice);
  const [locale, setLocale] = useState<keyof typeof catalogs>("en");
  Object.assign(window, { emailAudit: {
    title, garbled,
    setLocale,
    switchUser: () => { closeEmailDatabases(); setUserId(bob); },
    isolation: async () => {
      const other = emailDb(bob);
      const counts = await Promise.all(other.tables.map(async (table) => [table.name, await table.count()]));
      await clearSentMessages(other);
      return {
        counts: Object.fromEntries(counts),
        aliceSent: (await listSent(db)).length,
        aliceDrafts: (await listDrafts(db)).length,
      };
    },
    closedHandleRejects: async () => {
      try { await db.bodies.put({ headerId: "late-response", accountId, text: "Alice delayed secret", html: "", attachments: [] }); return false; }
      catch { return true; }
    },
  } });
  return <NextIntlClientProvider locale={locale} timeZone="UTC" messages={catalogs[locale]}>
    <CrmProvider initialUser={user(userId)} initialPermissions={permissions}>
      <main className="p-4">
        <section aria-label="Case summary"><CaseReportBar /></section>
        <EmailView initial={{ email: null, to: null, compose: false, recordId: null, recordType: "contact", folder: "Sent" }} />
      </main>
    </CrmProvider>
  </NextIntlClientProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
