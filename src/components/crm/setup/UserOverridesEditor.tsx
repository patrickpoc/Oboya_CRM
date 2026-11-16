"use client";

import { useTranslations } from "next-intl";
import { Check, Minus, Plus, X } from "lucide-react";
import type { CrmModule, PermissionLevel, PermissionOverrides } from "@/lib/crm/types";
import { CRM_ACTIONS, CRM_MODULES } from "@/lib/crm/types";
import {
  levelToActions,
  overrideCellState,
  toggleOverride,
  type OverrideCellState,
} from "@/lib/crm/setup/matrix";
import { cn } from "@/lib/utils";

const CELL_CLASSES: Record<OverrideCellState, string> = {
  allowed: "bg-oboya-green/10 text-oboya-green ring-1 ring-inset ring-oboya-green/25",
  blocked: "bg-transparent text-muted-foreground/40 ring-1 ring-inset ring-border/60",
  granted: "bg-oboya-green text-white shadow-sm",
  denied: "bg-oboya-orange text-white shadow-sm",
};

const CELL_ICONS: Record<OverrideCellState, typeof Check> = {
  allowed: Check,
  blocked: Minus,
  granted: Plus,
  denied: X,
};

/** Ported from the reference admin: per-user grants/denies over the role defaults. */
export function UserOverridesEditor({
  overrides,
  roleLevels,
  disabled,
  onChange,
}: {
  overrides: PermissionOverrides;
  roleLevels: Partial<Record<CrmModule, PermissionLevel>>;
  disabled?: boolean;
  onChange: (next: PermissionOverrides) => void;
}) {
  const t = useTranslations("setup.overrides");
  const tSetup = useTranslations("setup");

  const tipFor = (state: OverrideCellState) =>
    ({
      allowed: `${t("tipAllowedByRole")} · ${t("clickToDeny")}`,
      blocked: `${t("tipBlockedByRole")} · ${t("clickToGrant")}`,
      granted: `${t("tipGranted")} · ${t("clickToReset")}`,
      denied: `${t("tipDenied")} · ${t("clickToReset")}`,
    })[state];

  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
        {(["allowed", "blocked", "granted", "denied"] as OverrideCellState[]).map((state) => {
          const Icon = CELL_ICONS[state];
          return (
            <li key={state} className="flex items-center gap-1.5">
              <span className={cn("inline-flex size-5 items-center justify-center rounded-md", CELL_CLASSES[state])}>
                <Icon className="size-3" strokeWidth={2.5} />
              </span>
              {t(`legend.${state}`)}
            </li>
          );
        })}
      </ul>

      <div className="overflow-x-auto rounded-lg border border-border/60">
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead>
            <tr className="bg-oboya-soft-white">
              <th className="sticky left-0 z-10 min-w-32 border-b border-border/60 bg-oboya-soft-white px-3 py-2 text-left font-semibold text-oboya-blue-dark">
                {t("module")}
              </th>
              {CRM_ACTIONS.map((action) => (
                <th
                  key={action}
                  className="min-w-12 border-b border-border/60 px-1 py-2 text-center font-medium text-muted-foreground"
                >
                  {tSetup(`actions.${action}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CRM_MODULES.map((mod) => {
              const label = tSetup(`modules.${mod}`);
              const changed =
                levelToActions(overrides.grants?.[mod]).length + levelToActions(overrides.denies?.[mod]).length;
              return (
                <tr key={mod} className="group">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-b border-border/40 bg-white px-3 py-1.5 text-left font-medium whitespace-nowrap text-oboya-blue-dark group-hover:bg-oboya-soft-white"
                  >
                    <span className="flex items-center gap-2">
                      {label}
                      {changed > 0 ? <span className="size-1.5 rounded-full bg-oboya-orange" aria-hidden /> : null}
                    </span>
                  </th>
                  {CRM_ACTIONS.map((action) => {
                    const state = overrideCellState(overrides, roleLevels[mod], mod, action);
                    const Icon = CELL_ICONS[state];
                    return (
                      <td
                        key={action}
                        className="border-b border-border/40 px-1 py-1.5 text-center group-hover:bg-oboya-soft-white"
                      >
                        <button
                          type="button"
                          disabled={disabled}
                          title={tipFor(state)}
                          aria-label={`${label} ${tSetup(`actions.${action}`)}: ${t(`legend.${state}`)}`}
                          onClick={() => onChange(toggleOverride(overrides, roleLevels[mod], mod, action))}
                          className={cn(
                            "inline-flex size-7 items-center justify-center rounded-md transition-all",
                            CELL_CLASSES[state],
                            disabled
                              ? "cursor-not-allowed opacity-50"
                              : "hover:scale-105 hover:ring-2 hover:ring-oboya-blue-light/50"
                          )}
                        >
                          <Icon className="size-3.5" strokeWidth={2.5} />
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">{t("help")}</p>
    </div>
  );
}
