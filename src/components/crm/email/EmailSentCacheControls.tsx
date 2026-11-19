"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/crm/email/attachment-limits";
import { deleteSentMessage, type EmailDatabase, type SentMessage } from "@/lib/crm/email/local-db";

/** Clear only the local copies shown in the active mailbox/filter. */
export function EmailSentCacheControls({ db, messages, onDeleted }: {
  db: EmailDatabase;
  messages: SentMessage[];
  onDeleted: () => void | Promise<void>;
}) {
  const t = useTranslations("email");
  const [busy, setBusy] = useState(false);
  const clear = async () => {
    setBusy(true);
    try {
      await Promise.all(messages.map((message) => deleteSentMessage(db, message.id)));
      await onDeleted();
      toast.success(t("sent.cleared"));
    } catch {
      toast.error(t("errors.failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-white px-4 py-2.5">
      <p className="text-xs text-muted-foreground">
        {t("sent.summary", { count: messages.length, size: formatBytes(messages.reduce((sum, message) => sum + message.bytes, 0)) })}
      </p>
      <Button size="sm" variant="outline" className="rounded-full" disabled={busy} onClick={() => void clear()}>
        <Trash2 className="size-3.5" /> {t("sent.clearAll")}
      </Button>
    </div>
  );
}
