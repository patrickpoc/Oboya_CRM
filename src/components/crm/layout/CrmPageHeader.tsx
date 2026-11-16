"use client";

import { useCrmDocumentTitle } from "@/components/crm/layout/CrmRouteDocumentTitle";
import { cn } from "@/lib/utils";

export function CrmPageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  useCrmDocumentTitle(title);

  return (
    <div className={cn("mb-6 flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-semibold text-oboya-blue-dark">
          {title}
        </h1>
        {description ? (
          typeof description === "string" ? (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          ) : (
            <div className="mt-1">{description}</div>
          )
        ) : null}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
