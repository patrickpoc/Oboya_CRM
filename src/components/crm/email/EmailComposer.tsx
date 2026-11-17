"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { apiFetch } from "@/components/crm/common/api";
import { selectClass } from "@/components/crm/setup/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { emailDb, deleteDraft, ensureTemplates, saveDraft, type EmailTemplate } from "@/lib/crm/email/local-db";
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

export function EmailComposer({
  open,
  onOpenChange,
  accounts,
  initial,
  onSent,
  onDraftsChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: EmailAccount[];
  initial?: ComposeInitial | null;
  onSent?: () => void | Promise<void>;
  onDraftsChanged?: () => void | Promise<void>;
}) {
  const t = useTranslations("email");
  const [accountId, setAccountId] = useState("");
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [draftId, setDraftId] = useState("");
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the form when the dialog opens
    setDraftId(initial?.id ?? "");
    void (async () => {
      const stored = initial?.id ? await emailDb().drafts.get(initial.id).catch(() => undefined) : undefined;
      setAccountId(stored?.accountId ?? accounts[0]?.id ?? "");
      setTo(stored?.to.join(", ") ?? initial?.to ?? "");
      setCc(stored?.cc.join(", ") ?? initial?.cc ?? "");
      setSubject(stored?.subject ?? initial?.subject ?? "");
      setBody(stored?.text ?? initial?.body ?? "");
    })();
    void ensureTemplates()
      .then(() => emailDb().templates.orderBy("name").toArray())
      .then(setTemplates)
      .catch(() => undefined);
  }, [open, accounts, initial]);

  const recipients = (value: string) =>
    value
      .split(/[,;\n]/)
      .map((entry) => entry.trim())
      .filter(Boolean);

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
    await saveDraft(saved);
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
    setBusy(true);
    try {
      await apiFetch("/api/crm/email/send", {
        method: "POST",
        body: JSON.stringify({
          accountId,
          to: list,
          cc: recipients(cc),
          subject,
          text: body,
          html: "",
          inReplyTo: initial?.inReplyTo,
          logRecordId: initial?.recordId,
          logRecordType: initial?.recordType,
        }),
      });
      if (draftId) await deleteDraft(draftId).catch(() => undefined);
      toast.success(t("compose.sent"));
      onOpenChange(false);
      await onDraftsChanged?.();
      await onSent?.();
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
            <Textarea rows={10} value={body} onChange={(event) => setBody(event.target.value)} />
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
