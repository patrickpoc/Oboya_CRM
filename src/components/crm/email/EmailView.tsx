"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Inbox, MailPlus, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { CrmPageHeader } from "@/components/crm/layout/CrmPageHeader";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/crm/common/states";
import { apiFetch } from "@/components/crm/common/api";
import { useCrm } from "@/contexts/CrmContext";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { mapLimit } from "@/lib/crm/email/map-limit";
import { EmailAccountEditor } from "./EmailAccountEditor";
import { EmailComposer, type ComposeInitial } from "./EmailComposer";
import { EmailList } from "./EmailList";
import { EmailReader } from "./EmailReader";
import { EmailSentBox } from "./EmailSentBox";
import {
  applyMailAction,
  findCrmMatches,
  loadMailBody,
  searchAccountHistory,
  syncMailboxes,
  type MailAction,
} from "@/lib/crm/email/sync-client";
import {
  cachedBody,
  cachedHeaders,
  cacheAccounts,
  deleteDraft,
  headerKey,
  listDrafts,
  listSent,
  sentStorageBytes,
  type OutboxDraft,
  type SentMessage,
} from "@/lib/crm/email/local-db";
import type { CrmEmailMatch, EmailAccount, EmailPreset, MailBody, MailHeader } from "@/lib/crm/email/types";
import { createCaseFromEmail } from "@/lib/crm/cases/from-email-client";

export type EmailViewInitial = {
  email: string | null;
  to: string | null;
  compose: boolean;
  recordId: string | null;
  recordType: "contact" | "account";
  folder: string | null;
};

type AccountResponse = { accounts: EmailAccount[]; nextCursor: string | null };
type PresetResponse = { presets: readonly EmailPreset[] };
type FolderKey = "INBOX" | "Drafts" | "Sent" | "Trash";
const FOLDERS: FolderKey[] = ["INBOX", "Drafts", "Sent", "Trash"];
const AUTO_SYNC_MS = 60_000;
let lastAutoSync = 0;

function isFolder(value: string | null): value is FolderKey {
  return Boolean(value && FOLDERS.includes(value as FolderKey));
}

function matchesSearch(header: MailHeader, term: string): boolean {
  if (!term) return true;
  return `${header.subject} ${header.from.map((entry) => entry.address).join(" ")} ${header.to.map((entry) => entry.address).join(" ")}`
    .toLowerCase()
    .includes(term);
}

export function EmailView({ initial }: { initial: EmailViewInitial }) {
  const t = useTranslations("email");
  const tCases = useTranslations("cases");
  const { can } = useCrm();
  const canEdit = can("email", "edit");
  const canCreateCase = can("cases", "create");

  const [tab, setTab] = useState("mail");
  const [presets, setPresets] = useState<readonly EmailPreset[]>([]);
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [activeAccount, setActiveAccount] = useState("");
  const activeAccountRef = useRef("");
  const [folder, setFolder] = useState<FolderKey>(isFolder(initial.folder) ? initial.folder : "INBOX");
  const [headers, setHeaders] = useState<MailHeader[]>([]);
  const [customerHeaders, setCustomerHeaders] = useState<MailHeader[]>([]);
  const [drafts, setDrafts] = useState<OutboxDraft[]>([]);
  const [sent, setSent] = useState<SentMessage[]>([]);
  const [sentBytes, setSentBytes] = useState(0);
  const [selected, setSelected] = useState<MailHeader | null>(null);
  const [body, setBody] = useState<MailBody | null>(null);
  const [match, setMatch] = useState<CrmEmailMatch | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [compose, setCompose] = useState<ComposeInitial | null>(null);
  const composerOpened = useRef(false);

  const chooseAccount = useCallback((list: EmailAccount[]): EmailAccount | null => {
    const chosen =
      list.find((account) => account.id === activeAccountRef.current && account.enabled) ??
      list.find((account) => account.enabled) ??
      list[0] ??
      null;
    activeAccountRef.current = chosen?.id ?? "";
    setActiveAccount(activeAccountRef.current);
    return chosen;
  }, []);

  const reloadHeaders = useCallback(
    async (accountId: string, nextFolder: FolderKey) => {
      setLoading(true);
      try {
        const term = search.trim().toLowerCase();
        const rows = initial.email
          ? customerHeaders.filter((header) => header.accountId === accountId && header.folder === nextFolder)
          : accountId
            ? await cachedHeaders(accountId, nextFolder, 200)
            : [];
        setHeaders(rows.filter((header) => matchesSearch(header, term)));
        setError(null);
      } catch (caught) {
        setError(caught);
      } finally {
        setLoading(false);
      }
    },
    [customerHeaders, initial.email, search]
  );

  const loadCustomerHistory = useCallback(
    async (list: EmailAccount[], preferredId: string) => {
      if (!initial.email || list.length === 0) return;
      setSyncing(true);
      try {
        const results = await mapLimit(list.filter((account) => account.enabled), 2, async (account) => {
          try {
            const [sent, inbox] = await Promise.all([
              searchAccountHistory(account, "Sent", initial.email!),
              searchAccountHistory(account, "INBOX", initial.email!),
            ]);
            return [...sent, ...inbox];
          } catch {
            return [];
          }
        });
        const merged = results
          .flat()
          .filter((entry, index, all) => all.findIndex((other) => other.id === entry.id) === index)
          .sort((a, b) => b.date.localeCompare(a.date));
        setCustomerHeaders(merged);
        const targetFolder = isFolder(initial.folder) ? initial.folder : "Sent";
        setFolder(targetFolder);
        setHeaders(
          merged.filter((header) => header.accountId === preferredId && header.folder === targetFolder)
        );
      } finally {
        setSyncing(false);
      }
    },
    [initial.email, initial.folder]
  );

  const refreshDrafts = useCallback(async () => {
    try {
      setDrafts(await listDrafts());
    } catch {
      setDrafts([]);
    }
  }, []);

  const refreshSent = useCallback(async () => {
    try {
      const [messages, bytes] = await Promise.all([listSent(), sentStorageBytes()]);
      setSent(messages);
      setSentBytes(bytes);
    } catch {
      setSent([]);
      setSentBytes(0);
    }
  }, []);

  const refreshAccounts = useCallback(async () => {
    const [presetResponse, accountResponse] = await Promise.all([
      apiFetch<PresetResponse>("/api/crm/email/presets"),
      apiFetch<AccountResponse>("/api/crm/email/accounts?limit=100"),
    ]);
    setPresets(presetResponse.presets);
    setAccounts(accountResponse.accounts);
    await cacheAccounts(accountResponse.accounts).catch(() => undefined);
    const preferred = chooseAccount(accountResponse.accounts);
    await loadCustomerHistory(accountResponse.accounts, preferred?.id ?? "");
    return accountResponse.accounts;
  }, [chooseAccount, loadCustomerHistory]);

  const reloadHeadersRef = useRef(reloadHeaders);
  useEffect(() => {
    reloadHeadersRef.current = reloadHeaders;
  }, [reloadHeaders]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await refreshAccounts();
        await Promise.all([refreshDrafts(), refreshSent()]);
        if (cancelled) return;
        const selectedAccount = chooseAccount(list);
        if (!initial.email) {
          const targetFolder = isFolder(initial.folder) ? initial.folder : "INBOX";
          await reloadHeadersRef.current(selectedAccount?.id ?? "", targetFolder);
          if (Date.now() - lastAutoSync > AUTO_SYNC_MS) {
            lastAutoSync = Date.now();
            setSyncing(true);
            const result = await syncMailboxes(list.filter((account) => account.enabled), ["INBOX"], 100, 3);
            if (result.failed.length) toast.error(`${t("errors.failed")}: ${result.failed.join(", ")}`);
            await reloadHeadersRef.current(selectedAccount?.id ?? "", targetFolder);
            setSyncing(false);
          }
        }
        if (initial.compose && !composerOpened.current) {
          composerOpened.current = true;
          setCompose({
            to: initial.to ?? "",
            recordId: initial.recordId ?? undefined,
            recordType: initial.recordType,
          });
        }
      } catch (caught) {
        setError(caught);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    refreshAccounts,
    refreshDrafts,
    refreshSent,
    chooseAccount,
    initial.email,
    initial.folder,
    initial.to,
    initial.compose,
    initial.recordId,
    initial.recordType,
    t,
  ]);

  const selectHeader = useCallback(
    async (header: MailHeader) => {
      setSelected(header);
      setBody(null);
      setMatch(null);
      const cached = await cachedBody(header.id).catch(() => undefined);
      setBody(cached ?? null);
      try {
        const loaded = await loadMailBody(header);
        setBody(loaded);
        await applyMailAction([header], "read");
        const addresses = [...header.from, ...header.to].map((address) => address.address).filter(Boolean);
        if (addresses.length) {
          const matches = await findCrmMatches(addresses);
          setMatch(matches[0] ?? null);
        }
        setHeaders((current) => current.map((item) => (item.id === header.id ? { ...item, seen: true } : item)));
      } catch {
        toast.error(t("errors.failed"));
      }
    },
    [t]
  );

  const actOnSelected = useCallback(
    async (action: MailAction) => {
      if (!selected) return;
      try {
        await applyMailAction([selected], action);
        if (action === "delete") {
          setSelected(null);
          setBody(null);
          setCustomerHeaders((current) => current.filter((header) => header.id !== selected.id));
          await reloadHeaders(activeAccount, folder);
        } else {
          const patch =
            action === "read"
              ? { seen: true }
              : action === "unread"
                ? { seen: false }
                : action === "flag"
                  ? { flagged: true }
                  : action === "unflag"
                    ? { flagged: false }
                    : {};
          setSelected({ ...selected, ...patch });
          setHeaders((current) => current.map((item) => (item.id === selected.id ? { ...item, ...patch } : item)));
          setCustomerHeaders((current) => current.map((item) => (item.id === selected.id ? { ...item, ...patch } : item)));
        }
      } catch {
        toast.error(t("errors.failed"));
      }
    },
    [activeAccount, folder, reloadHeaders, selected, t]
  );

  const syncNow = async () => {
    setSyncing(true);
    try {
      const result = await syncMailboxes(accounts.filter((account) => account.enabled), [folder], 100, 3);
      if (result.failed.length) toast.error(`${t("errors.failed")}: ${result.failed.join(", ")}`);
      else toast.success(`${t("actions.refresh")}: ${result.synced}`);
      lastAutoSync = Date.now();
      await reloadHeaders(activeAccount, folder);
    } catch {
      toast.error(t("errors.failed"));
    } finally {
      setSyncing(false);
    }
  };

  const reply = () => {
    if (!selected) return;
    setCompose({
      to: selected.from.map((address) => address.address).join(", "),
      subject: selected.subject.startsWith("Re:") ? selected.subject : `Re: ${selected.subject}`,
      body: `\n\n--- ${selected.from[0]?.address ?? ""} ---\n${body?.text.slice(0, 2000) ?? ""}`,
      inReplyTo: selected.messageId,
      recordId: match?.id,
      recordType: match?.recordType,
    });
  };

  const createCase = useCallback(async () => {
    if (!selected) return;
    const messageId = selected.messageId?.trim() || headerKey(selected.accountId, selected.folder, selected.uid);
    try {
      const result = await createCaseFromEmail(
        {
          messageId,
          subject: selected.subject || t("reader.noSubject"),
          from: selected.from[0]?.address ?? "",
          body: body?.text ?? "",
        },
        match
      );
      toast.success(result.updated ? tCases("email.updated") : tCases("email.created"));
    } catch {
      toast.error(tCases("email.failed"));
    }
  }, [selected, body, match, t, tCases]);

  const openDraft = (draft: OutboxDraft) => {
    setCompose({
      id: draft.id,
      to: draft.to.join(", "),
      cc: draft.cc.join(", "),
      subject: draft.subject,
      body: draft.text,
      inReplyTo: draft.inReplyTo,
      recordId: draft.logRecordId,
      recordType: draft.logRecordType,
    });
  };

  const removeDraft = async (draft: OutboxDraft) => {
    try {
      await deleteDraft(draft.id);
      await refreshDrafts();
      toast.success(t("drafts.deleted"));
    } catch {
      toast.error(t("errors.failed"));
    }
  };

  const filteredHeaders = headers.filter((header) => matchesSearch(header, search.trim().toLowerCase()));

  return (
    <>
      <CrmPageHeader
        title={t("title")}
        description={
          <div className="flex flex-wrap items-center gap-2">
            <span>{t("description")}</span>
            {initial.email ? (
              <span className="rounded-full bg-oboya-soft-white px-2 py-0.5 text-xs text-oboya-blue">
                {t("customer.filter", { name: initial.email })}
              </span>
            ) : null}
          </div>
        }
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              disabled={syncing || loading || accounts.length === 0}
              onClick={() => void syncNow()}
            >
              <RefreshCw className={cn("size-4", syncing && "animate-spin")} /> {t("actions.refresh")}
            </Button>
            <Button
              size="sm"
              className="rounded-full bg-oboya-green text-white hover:bg-oboya-green/90"
              disabled={accounts.length === 0}
              onClick={() => setCompose({})}
            >
              <MailPlus className="size-4" /> {t("actions.compose")}
            </Button>
          </>
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="mail">{t("tabs.mail")}</TabsTrigger>
          <TabsTrigger value="drafts">{t("tabs.drafts")}</TabsTrigger>
          <TabsTrigger value="sent">{t("tabs.sent")}</TabsTrigger>
          <TabsTrigger value="accounts">{t("tabs.accounts")}</TabsTrigger>
        </TabsList>
        <TabsContent value="mail" className="mt-4">
          {error && accounts.length === 0 ? <ErrorState onRetry={() => void refreshAccounts()} /> : null}
          {!error && accounts.length === 0 ? (
            <EmptyState icon={Inbox} title={t("list.noAccounts")} description={t("list.noAccountsHint")} />
          ) : (
            <div className="grid min-h-[600px] gap-3 lg:grid-cols-[200px_minmax(0,340px)_minmax(0,1fr)]">
              <div className="space-y-3 rounded-xl border border-border/60 bg-white p-3">
                <p className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("account.title")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {accounts.map((account) => (
                    <button
                      key={account.id}
                      type="button"
                      className={cn(
                        "rounded-full border px-2 py-1 text-xs",
                        activeAccount === account.id ? "border-oboya-blue bg-oboya-soft-white text-oboya-blue" : "border-border/60"
                      )}
                      onClick={() => {
                        activeAccountRef.current = account.id;
                        setActiveAccount(account.id);
                        void reloadHeaders(account.id, folder);
                      }}
                    >
                      <span className="mr-1 inline-block size-2 rounded-full" style={{ backgroundColor: account.color }} />
                      {account.label}
                    </button>
                  ))}
                </div>
                <div className="space-y-1">
                  {FOLDERS.map((entry) => (
                    <button
                      key={entry}
                      type="button"
                      className={cn(
                        "w-full rounded-lg px-2 py-1.5 text-left text-sm",
                        folder === entry ? "bg-oboya-soft-white font-medium text-oboya-blue" : "hover:bg-muted/40"
                      )}
                      onClick={() => {
                        setFolder(entry);
                        void reloadHeaders(activeAccount, entry);
                      }}
                    >
                      {t(`folders.${entry.toLowerCase()}`)}
                    </button>
                  ))}
                </div>
                {initial.email ? (
                  <div className="rounded-lg border border-oboya-blue/20 bg-oboya-soft-white/60 p-2 text-xs text-muted-foreground">
                    {syncing ? t("customer.searching") : t("customer.hint")}
                  </div>
                ) : null}
              </div>

              {loading && headers.length === 0 ? <ListSkeleton rows={8} /> : (
                <EmailList
                  headers={filteredHeaders}
                  selectedId={selected?.id ?? null}
                  search={search}
                  loading={syncing}
                  onSearch={setSearch}
                  onSelect={(header) => void selectHeader(header)}
                  onAction={(header, action) =>
                    void applyMailAction([header], action).then(async () => {
                      setCustomerHeaders((current) => current.filter((item) => item.id !== header.id));
                      await reloadHeaders(activeAccount, folder);
                    })
                  }
                />
              )}

              <EmailReader
                header={selected}
                body={body}
                match={match}
                loading={Boolean(selected) && !body}
                onLoadBody={() => selected && void selectHeader(selected)}
                onAction={(action) => void actOnSelected(action)}
                onReply={reply}
                onCreateCase={() => void createCase()}
                canCreateCase={canCreateCase}
              />
            </div>
          )}
        </TabsContent>
        <TabsContent value="drafts" className="mt-4">
          {drafts.length === 0 ? (
            <EmptyState icon={Inbox} title={t("drafts.empty")} description={t("drafts.emptyHint")} />
          ) : (
            <div className="space-y-2">
              {drafts.map((draft) => (
                <div key={draft.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-white p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-oboya-blue-dark">{draft.subject || t("reader.noSubject")}</p>
                    <p className="truncate text-xs text-muted-foreground">{draft.to.join(", ") || "—"}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="outline" className="rounded-full" onClick={() => openDraft(draft)}>
                      <Pencil className="size-3.5" /> {t("actions.edit")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-full text-destructive"
                      onClick={() => void removeDraft(draft)}
                    >
                      <Trash2 className="size-3.5" /> {t("actions.discard")}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="sent" className="mt-4">
          <EmailSentBox messages={sent} storageBytes={sentBytes} onDeleted={() => refreshSent()} />
        </TabsContent>
        <TabsContent value="accounts" className="mt-4">
          <EmailAccountEditor
            presets={presets}
            accounts={accounts}
            canEdit={canEdit}
            onChanged={() => {
              void refreshAccounts();
            }}
          />
        </TabsContent>
      </Tabs>

      <EmailComposer
        open={Boolean(compose)}
        onOpenChange={(open) => !open && setCompose(null)}
        accounts={accounts}
        initial={compose}
        onSent={() => {
          void refreshAccounts();
          void refreshSent();
        }}
        onDraftsChanged={() => refreshDrafts()}
      />
      {!accounts.length && tab === "mail" ? (
        <Button className="mt-4 rounded-full" variant="outline" onClick={() => setTab("accounts")}>
          <Plus className="size-4" /> {t("actions.addAccount")}
        </Button>
      ) : null}
    </>
  );
}
