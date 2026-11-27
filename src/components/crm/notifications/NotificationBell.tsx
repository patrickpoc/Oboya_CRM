"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { AlarmClock, Bell, CalendarClock, Hourglass, ListChecks, UserPlus, X, type LucideIcon } from "lucide-react";
import { apiFetch } from "@/components/crm/common/api";
import { useNavCounts } from "@/components/crm/layout/use-nav-counts";
import {
  NOTIFICATIONS_API,
  type MarkReadResponse,
  type NotificationsResponse,
} from "@/lib/crm/automation/api-contract";
import { NOTIFICATION_KIND_META, isNotificationKind } from "@/lib/crm/notifications/kinds";
import type { Notification } from "@/lib/crm/notifications/schemas";
import { cn } from "@/lib/utils";


const ICONS: Record<string, LucideIcon> = { AlarmClock, Hourglass, CalendarClock, ListChecks, UserPlus };
const PAGE = 20;
/** ICU params every kind message may use; missing ones render empty instead of throwing. */
const PARAM_KEYS = ["name", "subject", "days", "hours"] as const;

function messageValues(params: Notification["params"]): Record<string, string | number> {
  const values: Record<string, string | number> = {};
  for (const key of PARAM_KEYS) values[key] = "";
  for (const [k, v] of Object.entries(params ?? {})) if (v !== null && v !== undefined) values[k] = v;
  return values;
}

export function NotificationBell() {
  const t = useTranslations("notifications.bell");
  const tk = useTranslations("notifications");
  const format = useFormatter();
  const router = useRouter();
  const navCount = useNavCounts().notificationsUnread ?? 0;
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  // Server count after a local change; ignored once polling reports a new value.
  const [override, setOverride] = useState<{ base: number; value: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previous = useRef(navCount);
  const [announcement, setAnnouncement] = useState("");

  const count = override && override.base === navCount ? override.value : navCount;

  useEffect(() => {
    if (previous.current === count) return;
    previous.current = count;
    setAnnouncement(t("announce", { count }));
  }, [count, t]);

  const load = useCallback(
    async (after: string | null) => {
      setStatus("loading");
      try {
        const query = new URLSearchParams({ limit: String(PAGE), ...(after ? { cursor: after } : {}) });
        const res = await apiFetch<NotificationsResponse>(`${NOTIFICATIONS_API.list}?${query}`, { quiet: true });
        setItems((prev) => (after ? [...prev, ...res.notifications] : res.notifications));
        setCursor(res.nextCursor);
        setOverride({ base: navCount, value: res.unreadCount });
        setStatus("idle");
      } catch {
        setStatus("error");
      }
    },
    [navCount]
  );

  const toggle = () => {
    if (open) return close();
    setOpen(true);
    setItems([]);
    setCursor(null);
    void load(null);
  };

  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  // Move focus into the panel when it opens.
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  const markRead = async (body: { ids: string[] } | { all: true }) => {
    const now = new Date().toISOString();
    setItems((prev) =>
      prev.map((n) => ("all" in body || body.ids.includes(n.id) ? { ...n, readAt: n.readAt ?? now } : n))
    );
    try {
      const res = await apiFetch<MarkReadResponse>(NOTIFICATIONS_API.read, {
        method: "POST",
        quiet: true,
        body: JSON.stringify(body),
      });
      setOverride({ base: navCount, value: res.unreadCount });
      window.dispatchEvent(new Event("crm:nav-counts"));
    } catch {
      void load(null);
    }
  };

  const openItem = (n: Notification) => {
    if (!n.readAt) void markRead({ ids: [n.id] });
    const meta = isNotificationKind(n.kind) ? NOTIFICATION_KIND_META[n.kind] : null;
    if (meta && n.object && n.recordId) {
      setOpen(false);
      router.push(meta.href(n.object, n.recordId));
    }
  };

  const badge = count > 99 ? t("cap") : String(count);
  const anyUnread = count > 0 || items.some((n) => !n.readAt);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={count > 0 ? t("labelUnread", { count }) : t("label")}
        className={cn(
          "relative flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted",
          open && "bg-muted"
        )}
      >
        <Bell className="size-5" aria-hidden />
        {count > 0 ? (
          <span
            aria-hidden
            data-testid="notification-badge"
            className="absolute top-1 right-0.5 min-w-4 rounded-full bg-oboya-orange px-1 text-center text-[10px] leading-4 font-semibold text-white"
          >
            {badge}
          </span>
        ) : null}
      </button>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-label={t("title")}
          tabIndex={-1}
          className="fixed inset-x-0 top-14 z-50 flex outline-none max-h-[calc(100dvh-3.5rem)] flex-col border-y border-border/60 bg-white shadow-[var(--shadow-card)] sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:max-h-[min(32rem,calc(100dvh-5rem))] sm:w-96 sm:rounded-xl sm:border"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-2.5">
            <h2 className="text-sm font-semibold text-oboya-blue-dark">{t("title")}</h2>
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={!anyUnread}
                onClick={() => void markRead({ all: true })}
                className="min-h-11 rounded px-2 text-xs font-medium text-oboya-blue hover:underline disabled:opacity-40 md:min-h-8"
              >
                {t("markAllRead")}
              </button>
              <button
                type="button"
                onClick={close}
                aria-label={t("close")}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted sm:hidden"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={status === "loading"}>
            {status === "error" && items.length === 0 ? (
              <div role="alert" className="space-y-2 px-4 py-6 text-center text-sm text-oboya-orange">
                <p>{t("failed")}</p>
                <button type="button" onClick={() => void load(null)} className="min-h-11 text-oboya-blue underline md:min-h-8">
                  {t("retry")}
                </button>
              </div>
            ) : status === "loading" && items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t("loading")}</p>
            ) : items.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm font-medium text-oboya-blue-dark">{t("empty")}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t("emptyDescription")}</p>
              </div>
            ) : (
              <ul className="divide-y divide-border/50">
                {items.map((n) => {
                  const meta = isNotificationKind(n.kind) ? NOTIFICATION_KIND_META[n.kind] : null;
                  const Icon = (meta && ICONS[meta.icon]) || Bell;
                  const values = messageValues(n.params);
                  const unread = !n.readAt;
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => openItem(n)}
                        data-unread={unread ? "true" : "false"}
                        className={cn(
                          "flex min-h-11 w-full items-start gap-3 px-4 py-3 text-left hover:bg-oboya-soft-white",
                          unread && "bg-oboya-blue/5"
                        )}
                      >
                        <Icon className="mt-0.5 size-4 shrink-0 text-oboya-blue" aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-oboya-blue-dark">
                            {meta ? tk(meta.titleKey, values) : n.kind}
                          </span>
                          {meta ? (
                            <span className="block text-xs break-words text-muted-foreground">{tk(meta.bodyKey, values)}</span>
                          ) : null}
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">
                            {format.relativeTime(new Date(n.createdAt))}
                          </span>
                        </span>
                        {unread ? (
                          <>
                            <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-oboya-orange" />
                            <span className="sr-only">{t("unread")}</span>
                          </>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            {cursor ? (
              <div className="border-t border-border/50 p-2 text-center">
                <button
                  type="button"
                  disabled={status === "loading"}
                  onClick={() => void load(cursor)}
                  className="min-h-11 rounded px-3 text-xs font-medium text-oboya-blue hover:underline disabled:opacity-50 md:min-h-8"
                >
                  {status === "loading" ? t("loading") : t("loadMore")}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
