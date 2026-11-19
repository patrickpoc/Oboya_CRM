"use client";

import { useFormatter, useTranslations } from "next-intl";
import { Paperclip, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { MailHeader } from "@/lib/crm/email/types";
import type { MailAction } from "@/lib/crm/email/sync-client";

export function EmailList({
  headers,
  selectedId,
  search,
  loading,
  canEdit,
  onSearch,
  onSelect,
  onAction,
}: {
  headers: MailHeader[];
  selectedId: string | null;
  search: string;
  loading: boolean;
  canEdit: boolean;
  onSearch: (value: string) => void;
  onSelect: (header: MailHeader) => void;
  onAction: (header: MailHeader, action: MailAction) => void;
}) {
  const t = useTranslations("email");
  const format = useFormatter();
  const formatDate = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : format.dateTime(date, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-col rounded-xl border border-border/60 bg-white">
      <div className="border-b border-border/50 p-3">
        <Input value={search} placeholder={t("list.search")} onChange={(event) => onSearch(event.target.value)} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && headers.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("list.syncing")}</p>
        ) : headers.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{t("list.empty")}</p>
        ) : (
          headers.map((header) => (
            <div
              key={header.id}
              role="button"
              tabIndex={0}
              className={cn(
                "group cursor-pointer border-b border-border/40 px-3 py-3 last:border-b-0",
                selectedId === header.id ? "bg-oboya-soft-white" : "hover:bg-muted/40",
                !header.seen && "font-medium"
              )}
              onClick={() => onSelect(header)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onSelect(header);
              }}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 truncate text-sm text-oboya-blue-dark">
                  {header.folder === "Sent" ? header.to.map((entry) => entry.name || entry.address).join(", ") : header.from[0]?.name || header.from[0]?.address || "—"}
                </p>
                <time dateTime={header.date} className="shrink-0 text-[11px] text-muted-foreground">{formatDate(header.date)}</time>
              </div>
              <p className="truncate text-sm">{header.subject || t("reader.noSubject")}</p>
              {header.hasAttachments ? (
                <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Paperclip className="size-3" /> {header.attachments.length}
                </p>
              ) : null}
              {canEdit ? <div className="mt-1 flex gap-1 transition sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6"
                  aria-label={t("actions.star")}
                  disabled={header.uid === 0}
                  onClick={(event) => {
                    event.stopPropagation();
                    onAction(header, header.flagged ? "unflag" : "flag");
                  }}
                >
                  <Star className={cn("size-3.5", header.flagged && "fill-current text-oboya-yellow-dark")} />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6 text-destructive"
                  aria-label={t("actions.delete")}
                  onClick={(event) => {
                    event.stopPropagation();
                    onAction(header, "delete");
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div> : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
