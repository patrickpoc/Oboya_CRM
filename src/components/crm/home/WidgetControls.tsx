"use client";

import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { WIDGET_SPAN } from "@/lib/crm/home/widgets";
import { WIDGET_SIZES, type WidgetSize } from "@/lib/crm/reports/definition";
import { cn } from "@/lib/utils";

/**
 * Edit-mode frame around a widget: move up/down (buttons or Alt+Arrow on the
 * frame), size select and remove. The parent announces moves through aria-live.
 */
export function WidgetFrame({
  label,
  index,
  count,
  size,
  onMove,
  onSize,
  onRemove,
  extra,
  children,
}: {
  label: string;
  index: number;
  count: number;
  size: WidgetSize;
  onMove: (delta: -1 | 1) => void;
  onSize: (size: WidgetSize) => void;
  onRemove: () => void;
  /** Extra controls (e.g. chart override select). */
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTranslations("home.edit");
  return (
    <div
      role="group"
      aria-label={label}
      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
      tabIndex={0}
      onKeyDown={(e) => {
        if (!e.altKey || e.target !== e.currentTarget) return;
        const delta = e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : 0;
        if (delta) {
          e.preventDefault();
          onMove(delta);
        }
      }}
      className={cn(
        "min-w-0 rounded-xl outline-2 outline-dashed outline-oboya-blue/30 focus-visible:outline-oboya-blue-light",
        WIDGET_SPAN[size],
      )}
    >
      <div className="flex flex-wrap items-center gap-2 rounded-t-xl bg-oboya-soft-white px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-oboya-blue-dark">{label}</span>
        <Button type="button" variant="outline" size="icon-sm" disabled={index === 0} onClick={() => onMove(-1)} aria-label={t("moveUp", { name: label })}>
          <ArrowUp aria-hidden />
        </Button>
        <Button type="button" variant="outline" size="icon-sm" disabled={index === count - 1} onClick={() => onMove(1)} aria-label={t("moveDown", { name: label })}>
          <ArrowDown aria-hidden />
        </Button>
        <select
          value={size}
          onChange={(e) => onSize(e.target.value as WidgetSize)}
          aria-label={t("size", { name: label })}
          className="h-8 rounded-md border border-border/70 bg-white px-2 text-xs text-oboya-blue-dark"
        >
          {WIDGET_SIZES.map((s) => (
            <option key={s} value={s}>
              {t(`sizes.${s}`)}
            </option>
          ))}
        </select>
        {extra}
        <Button type="button" variant="outline" size="icon-sm" onClick={onRemove} aria-label={t("remove", { name: label })}>
          <Trash2 aria-hidden />
        </Button>
      </div>
      <div className="pointer-events-none select-none opacity-80 [&_a]:pointer-events-none">{children}</div>
    </div>
  );
}

/** Visually hidden live region for reorder announcements. */
export function LiveAnnouncer({ message }: { message: string }) {
  return (
    <p role="status" aria-live="polite" className="sr-only">
      {message}
    </p>
  );
}
