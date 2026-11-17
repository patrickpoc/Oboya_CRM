"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Download, Inbox, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/crm/common/states";
import { formatBytes } from "@/lib/crm/email/attachment-limits";
import type { SentMessage } from "@/lib/crm/email/local-db";

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

export function EmailSentBox({
  messages,
  storageBytes,
  onDeleted,
}: {
  messages: SentMessage[];
  storageBytes: number;
  onDeleted: () => void | Promise<void>;
}) {
  const t = useTranslations("email");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const removeOne = async (message: SentMessage) => {
    const { deleteSentMessage } = await import("@/lib/crm/email/local-db");
    setBusy(true);
    try {
      await deleteSentMessage(message.id);
      await onDeleted();
      toast.success(t("sent.deleted"));
    } catch {
      toast.error(t("errors.failed"));
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    const { clearSentMessages } = await import("@/lib/crm/email/local-db");
    setBusy(true);
    try {
      await clearSentMessages();
      await onDeleted();
      toast.success(t("sent.cleared"));
    } catch {
      toast.error(t("errors.failed"));
    } finally {
      setBusy(false);
    }
  };

  const download = (filename: string, blob: Blob) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!messages.length) {
    return <EmptyState icon={Inbox} title={t("sent.empty")} description={t("sent.emptyHint")} />;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-white px-4 py-2.5">
        <p className="text-xs text-muted-foreground">
          {t("sent.summary", { count: messages.length, size: formatBytes(storageBytes) })}
        </p>
        <Button size="sm" variant="outline" className="rounded-full text-destructive" disabled={busy} onClick={() => void clearAll()}>
          <Trash2 className="size-3.5" /> {t("sent.clearAll")}
        </Button>
      </div>
      {messages.map((message) => (
        <div key={message.id} className="rounded-xl border border-border/60 bg-white p-3">
          <div className="flex items-start justify-between gap-3">
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => setExpanded((current) => (current === message.id ? null : message.id))}
            >
              <p className="truncate text-sm font-medium text-oboya-blue-dark">{message.subject || t("reader.noSubject")}</p>
              <p className="truncate text-xs text-muted-foreground">
                {t("reader.to")}: {message.to.join(", ")}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {message.accountLabel ? `${message.accountLabel} · ` : ""}
                {formatDate(message.date)}
                {message.attachments.length ? ` · 📎 ${message.attachments.length}` : ""}
                {` · ${formatBytes(message.bytes)}`}
              </p>
            </button>
            <Button
              size="sm"
              variant="ghost"
              className="shrink-0 rounded-full text-destructive"
              disabled={busy}
              onClick={() => void removeOne(message)}
            >
              <Trash2 className="size-3.5" /> {t("actions.delete")}
            </Button>
          </div>
          {expanded === message.id ? (
            <div className="mt-3 space-y-3 border-t border-border/40 pt-3">
              <div className="whitespace-pre-wrap rounded-lg bg-oboya-soft-white/40 p-3 text-sm">
                {message.text || message.html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()}
              </div>
              {message.attachments.length ? (
                <div className="flex flex-wrap gap-2">
                  {message.attachments.map((attachment) => (
                    <Button
                      key={attachment.id}
                      size="sm"
                      variant="outline"
                      className="rounded-full"
                      onClick={() => download(attachment.filename, attachment.blob)}
                    >
                      <Download className="size-3.5" /> {attachment.filename}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
