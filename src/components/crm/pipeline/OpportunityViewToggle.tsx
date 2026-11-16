"use client";

import Link from "next/link";
import { Columns3, List } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/** List / kanban switch shown in both opportunity page headers. */
export function OpportunityViewToggle({ current }: { current: "list" | "kanban" }) {
  const t = useTranslations("opportunities.viewToggle");
  const items = [
    { key: "list" as const, href: "/opportunities", icon: List, label: t("list") },
    { key: "kanban" as const, href: "/opportunities/pipeline", icon: Columns3, label: t("kanban") },
  ];
  return (
    <nav aria-label={t("label")} className="inline-flex rounded-full border border-border/70 bg-white p-0.5">
      {items.map((item) => {
        const active = item.key === current;
        const Icon = item.icon;
        return (
          <Link
            key={item.key}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
              active ? "bg-oboya-blue text-white" : "text-oboya-blue-dark hover:bg-oboya-soft-white"
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
