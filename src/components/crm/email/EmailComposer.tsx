"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Paperclip, Send, X } from "lucide-react";
import { selectClass } from "@/components/crm/setup/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  MAX_TOTAL_ATTACHMENT_BYTES,
  formatBytes,
} from "@/lib/crm/email/attachment-limits";
import { deleteDraft, saveDraft, type EmailDatabase, type EmailTemplate } from "@/lib/crm/email/local-db";
import { mergeEmailTemplates } from "@/lib/crm/email/templates";
import { sendEmailMessage } from "@/lib/crm/email/sync-client";
import type { EmailAccount } from "@/lib/crm/email/types";

export type ComposeInitial = {
  id?: string;
  to?: string;
  cc?: string;
  subject?: string;
  body?: string;
  inReplyTo?: string;
  recordId?: string;
  recordType?: "contact" | "account";
};

type PickedFile = { id: string; file: File };

export function EmailComposer({
  db,
  open,
  onOpenChange,
  accounts,
  initial,
  onSent,
  onDraftsChanged,
}: {
  db: EmailDatabase;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: EmailAccount[];
  initial?: ComposeInitial | null;
  onSent?: (accountId: string) => void | Promise<void>;
  onDraftsChanged?: () => void | Promise<void>;
}) {
  const t = useTranslations("email");
  const fileInput = useRef<HTMLInputElement>(null);
  const [accountId, setAccountId] = useState("");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [draftId, setDraftId] = useState("");
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [storedTemplates, setStoredTemplates] = useState<EmailTemplate[]>([]);
  const [busy, setBusy] = useState(false);
  const templates = useMemo(() => mergeEmailTemplates(storedTemplates, [
    { id: "follow-up", name: t("templates.followUp.name"), subject: t("templates.followUp.subject"), body: t("templates.followUp.body"), updatedAt: new Date(0).toISOString() },
    { id: "quotation", name: t("templates.quotation.name"), subject: t("templates.quotation.subject"), body: t("templates.quotation.body"), updatedAt: new Date(0).toISOString() },
  ]), [storedTemplates, t]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the form when the dialog opens
    setDraftId(initial?.id ?? "");
    setFiles([]);
    void (async () => {
      const stored = initial?.id ? await db.drafts.get(initial.id).catch(() => undefined) : undefined;
      setAccountId(stored?.accountId ?? accounts[0]?.id ?? "");
      setTo(stored?.to.join(", ") ?? initial?.to ?? "");
      setCc(stored?.cc.join(", ") ?? initial?.cc ?? "");
      setSubject(stored?.subject ?? initial?.subject ?? "");
      setBody(stored?.text ?? initial?.body ?? "");
    })();
    void db.templates.orderBy("name").toArray()
      .then(setStoredTemplates)
      .catch(() => undefined);
  }, [open, accounts, initial, db]);

  const recipients = (value: string) =>
    value
      .split(/[,;\n]/)
      .map((entry) => entry.trim())
      .filter(Boolean);

  const totalSize = files.reduce((sum, entry) => sum + entry.file.size, 0);

  const addFiles = (picked: FileList | null) => {
    if (!picked?.length) return;
    const incoming = Array.from(picked);
    const next = [...files];
    for (const file of incoming) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        toast.error(t("compose.attachmentTooLarge", { max: formatBytes(MAX_ATTACHMENT_BYTES) }));
        continue;
      }
      if (next.length >= MAX_ATTACHMENT_COUNT) {
        toast.error(t("compose.attachmentTooMany", { max: MAX_ATTACHMENT_COUNT }));
        break;
      }
      next.push({ id: crypto.randomUUID(), file });
    }
    const sum = next.reduce((acc, entry) => acc + entry.file.size, 0);
    if (sum > MAX_TOTAL_ATTACHMENT_BYTES) {
      toast.error(t("compose.attachmentTotalTooLarge", { max: formatBytes(MAX_TOTAL_ATTACHMENT_BYTES) }));
    } else {
      setFiles(next);
    }
    if (fileInput.current) fileInput.current.value = "";
  };

  const draft = () => ({
    id: draftId || crypto.randomUUID(),
    accountId,
    to: recipients(to),
    cc: recipients(cc),
    subject,
    text: body,
    html: "",
    inReplyTo: initial?.inReplyTo,
    logRecordId: initial?.recordId,
    logRecordType: initial?.recordType,
    updatedAt: new Date().toISOString(),
    synced: false,
  });

  const save = async () => {
    if (!accountId) return;
    const saved = draft();
    await saveDraft(db, saved);
    setDraftId(saved.id);
    toast.success(t("compose.saved"));
    await onDraftsChanged?.();
  };

  const send = async () => {
    const list = recipients(to);
    if (!accountId || list.length === 0) {
      toast.error(t("compose.required"));
      return;
    }
    if (totalSize > MAX_TOTAL_ATTACHMENT_BYTES) {
      toast.error(t("compose.attachmentTotalTooLarge", { max: formatBytes(MAX_TOTAL_ATTACHMENT_BYTES) }));
      return;
    }
    setBusy(true);
    try {
      const account = accounts.find((entry) => entry.id === accountId);
      await sendEmailMessage(db,
        {
          accountId,
          to: list,
          cc: recipients(cc),
          subject,
          text: body,
          html: "",
          inReplyTo: initial?.inReplyTo,
          logRecordId: initial?.recordId,
          logRecordType: initial?.recordType,
        },
        files.map((entry) => entry.file),
        account
      );
      if (draftId) await deleteDraft(db, draftId).catch(() => undefined);
      toast.success(t("compose.sent"));
      onOpenChange(false);
      await onDraftsChanged?.();
      await onSent?.(accountId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("errors.failed"));
    } finally {
      setBusy(false);
    }
  };

  const applyTemplate = (id: string) => {
    const template = templates.find((entry) => entry.id === id);
    if (!template) return;
    setSubject(template.subject);
    setBody(template.body);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("compose.title")}</DialogTitle>
        </DialogHeader>
        {templates.length ? (
          <div className="space-y-1.5">
            <Label>{t("compose.template")}</Label>
            <select className={selectClass} defaultValue="" onChange={(event) => applyTemplate(event.target.value)}>
              <option value="">—</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>{t("account.title")}</Label>
            <select className={selectClass} value={accountId} onChange={(event) => setAccountId(event.target.value)}>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label} · {account.email}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("compose.to")}</Label>
            <Input value={to} onChange={(event) => setTo(event.target.value)} placeholder="name@example.com" />
          </div>
          <div className="space-y-1.5">
            <Label>{t("compose.cc")}</Label>
            <Input value={cc} onChange={(event) => setCc(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("compose.subject")}</Label>
            <Input value={subject} onChange={(event) => setSubject(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("compose.body")}</Label>
            <Textarea rows={9} value={body} onChange={(event) => setBody(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>{t("compose.attachments")}</Label>
              <span className="text-[11px] text-muted-foreground">
                {t("compose.attachmentLimit", { max: formatBytes(MAX_TOTAL_ATTACHMENT_BYTES), count: MAX_ATTACHMENT_COUNT })}
              </span>
            </div>
            <input
              ref={fileInput}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => addFiles(event.target.files)}
            />
            <Button size="sm" variant="outline" className="rounded-full" onClick={() => fileInput.current?.click()}>
              <Paperclip className="size-3.5" /> {t("compose.addAttachment")}
            </Button>
            {files.length ? (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {files.map((entry) => (
                  <span
                    key={entry.id}
                    className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/40 py-0.5 pl-2 pr-1 text-xs"
                  >
                    <span className="max-w-[160px] truncate">{entry.file.name}</span>
                    <span className="text-muted-foreground">{formatBytes(entry.file.size)}</span>
                    <button
                      type="button"
                      className="rounded-full p-0.5 text-muted-foreground hover:text-destructive"
                      onClick={() => setFiles((current) => current.filter((item) => item.id !== entry.id))}
                      aria-label={t("compose.removeAttachment")}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                <span className="self-center text-[11px] text-muted-foreground">{formatBytes(totalSize)}</span>
              </div>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="rounded-full" disabled={busy || !accountId} onClick={() => void save()}>
            {t("actions.saveDraft")}
          </Button>
          <Button
            className="rounded-full bg-oboya-green text-white hover:bg-oboya-green/90"
            disabled={busy || !accountId}
            onClick={() => void send()}
          >
            <Send className="size-4" /> {t("actions.send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
