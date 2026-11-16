"use client";

import { useTranslations } from "next-intl";

export function AccessDenied({ className = "text-sm text-muted-foreground" }: { className?: string }) {
  const t = useTranslations("shell");
  return <p className={className}>{t("accessDenied")}</p>;
}
