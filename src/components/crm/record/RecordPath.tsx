"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export type PathStep = { value: string; label: string; kind?: "open" | "won" | "lost" };

/**
 * Salesforce-style chevron stage bar (brand tokens only). Steps before the
 * current one are completed. Clicking a step calls `onStageChange`; the caller
 * decides what happens (PATCH, a dialog for Closed Lost, …).
 */
export function RecordPath({
  steps,
  current,
  onStageChange,
  disabled,
  className,
}: {
  steps: PathStep[];
  current: string | null;
  onStageChange?: (value: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const t = useTranslations("record.path");
  const currentIndex = steps.findIndex((s) => s.value === current);

  return (
    <nav aria-label={t("label")} className={cn("overflow-x-auto pb-1", className)}>
      <ol className="flex min-w-max gap-1 sm:min-w-0">
        {steps.map((step, index) => {
          const isCurrent = index === currentIndex;
          const isDone = currentIndex >= 0 && index < currentIndex;
          const tone = isCurrent
            ? step.kind === "lost"
              ? "bg-oboya-orange text-white"
              : step.kind === "won"
                ? "bg-oboya-green text-white"
                : "bg-oboya-blue-dark text-white"
            : isDone
              ? "bg-oboya-blue text-white hover:bg-oboya-blue/90"
              : "bg-oboya-soft-white text-oboya-blue-dark ring-1 ring-inset ring-border/70 hover:bg-oboya-blue-light/15";
          const first = index === 0;
          const last = index === steps.length - 1;
          return (
            <li key={step.value} className="min-w-28 flex-1 sm:min-w-0">
              <button
                type="button"
                disabled={disabled || isCurrent || !onStageChange}
                aria-current={isCurrent ? "step" : undefined}
                title={isCurrent ? t("current") : isDone ? t("completed") : t("markCurrent")}
                onClick={() => onStageChange?.(step.value)}
                className={cn(
                  "group flex h-9 w-full items-center justify-center gap-1 px-5 text-xs font-semibold transition-colors outline-none disabled:cursor-default",
                  tone,
                  // clip-path cuts the side edges of a box ring, so the inset ring shows top/bottom
                  // and the label gets its own (never-clipped) ring inside the padding.
                  "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-oboya-blue-light",
                  first ? "rounded-l-full pl-4" : "",
                  last ? "rounded-r-full pr-4" : ""
                )}
                style={{
                  clipPath: `polygon(${first ? "0 0" : "0 0, 10px 50%, 0 100%"}${
                    first ? ", 0 100%" : ""
                  }, ${last ? "100% 100%, 100% 0" : "calc(100% - 10px) 100%, 100% 50%, calc(100% - 10px) 0"})`,
                }}
              >
                {isDone ? <Check className="size-3.5 shrink-0" aria-hidden /> : null}
                <span className="truncate rounded-sm px-0.5 group-focus-visible:ring-2 group-focus-visible:ring-oboya-blue-light">
                  {step.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
