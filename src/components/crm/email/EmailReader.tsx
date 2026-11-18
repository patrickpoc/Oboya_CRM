"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Download, LifeBuoy, Mail, Reply } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { loadAttachmentBlob, type MailAction } from "@/lib/crm/email/sync-client";
import type { CrmEmailMatch, MailBody, MailHeader } from "@/lib/crm/email/types";

function formatFull(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

export function EmailReader({
  header,
  body,
  match,
  loading,
  onLoadBody,
  onAction,
  onReply,
  onCreateCase,
  canCreateCase,
}: {
  header: MailHeader | null;
  body: MailBody | null;
  match: CrmEmailMatch | null;
  loading: boolean;
  onLoadBody: () => void;
  onAction: (action: MailAction) => void;
  onReply: () => void;
  onCreateCase: () => void;
  canCreateCase: boolean;
}) {
  const t = useTranslations("email");
  const tCases = useTranslations("cases");
  const [downloading, setDownloading] = useState<string | null>(null);

  if (!header) {
    return (
      <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-border/60 bg-white">
        <div className="text-center text-muted-foreground">
          <Mail className="mx-auto size-6" />
          <p className="mt-2 text-sm">{t("reader.select")}</p>
        </div>
      </div>
    );
  }

  const download = async (part: string, filename: string, contentType: string) => {
    setDownloading(part);
    try {
      const blob = await loadAttachmentBlob(header, part, filename, contentType);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error(t("errors.failed"));
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="min-h-[420px] space-y-4 rounded-xl border border-border/60 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-oboya-blue-dark">{header.subject}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{formatFull(header.date)}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="rounded-full" onClick={onReply}>
            <Reply className="size-4" /> {t("actions.reply")}
          </Button>
          {canCreateCase ? (
            <Button size="sm" variant="outline" className="rounded-full border-oboya-blue text-oboya-blue" onClick={onCreateCase}>
              <LifeBuoy className="size-4" /> {tCases("email.create")}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            className="rounded-full"
            onClick={() => onAction(header.seen ? "unread" : "read")}
          >
            {header.seen ? t("actions.markUnread") : t("actions.markRead")}
          </Button>
        </div>
      </div>

      <dl className="space-y-1 text-sm">
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-muted-foreground">{t("reader.from")}</dt>
          <dd className="min-w-0 break-all">
            {header.from.map((address, index) => (
              <span key={`${address.address}-${index}`}>
                {address.name ? `${address.name} ` : ""}&lt;{address.address}&gt;
              </span>
            ))}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-muted-foreground">{t("reader.to")}</dt>
          <dd className="min-w-0 break-all">{header.to.map((address) => address.address).join(", ")}</dd>
        </div>
      </dl>

      {match ? (
        <div className="rounded-lg border border-oboya-blue/20 bg-oboya-soft-white p-3 text-sm">
          <p className="text-xs text-muted-foreground">{t("reader.crmMatch")}</p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Link className="font-medium text-oboya-blue hover:underline" href={`/contacts/${match.id}`}>
              {match.fullName} → {t("reader.openContact")}
            </Link>
            {match.accountId ? (
              <Link className="font-medium text-oboya-blue hover:underline" href={`/accounts/${match.accountId}`}>
                {match.accountName ?? t("reader.openAccount")} → {t("reader.openAccount")}
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      {body ? (
        <div className="whitespace-pre-wrap rounded-lg border border-border/50 bg-oboya-soft-white/40 p-4 text-sm leading-relaxed">
          {body.text || body.html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()}
        </div>
      ) : loading ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <div className="rounded-lg border border-dashed border-border/60 p-4 text-sm text-muted-foreground">
          <p>{t("reader.noBody")}</p>
          <Button size="sm" variant="outline" className="mt-2 rounded-full" onClick={onLoadBody}>
            {t("reader.loadBody")}
          </Button>
        </div>
      )}

      {header.attachments.length ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">{t("reader.attachments")}</p>
          <p className="text-[11px] text-muted-foreground">{t("reader.attachmentHint")}</p>
          <div className="flex flex-wrap gap-2">
            {header.attachments.map((attachment) => (
              <Button
                key={attachment.part}
                size="sm"
                variant="outline"
                className="rounded-full"
                disabled={downloading === attachment.part}
                onClick={() => void download(attachment.part, attachment.filename, attachment.contentType)}
              >
                <Download className="size-3.5" /> {attachment.filename}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
