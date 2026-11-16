"use client";

import { useTranslations } from "next-intl";
import type { CrmAction, CrmModule, PermissionLevel } from "@/lib/crm/types";
import { CRM_ACTIONS, CRM_MODULES } from "@/lib/crm/types";
import type { AccessMatrix } from "@/lib/crm/permissions/access-types";
import { levelToActions, toggleAction } from "@/lib/crm/setup/matrix";
import { cn } from "@/lib/utils";

/** Ported from the reference admin MatrixEditor: CRM modules x actions for one role. */
export function MatrixEditor({
  roleId,
  locked,
  matrix,
  onChange,
}: {
  roleId: string;
  locked: boolean;
  matrix: AccessMatrix;
  onChange: (module: CrmModule, level: PermissionLevel) => void;
}) {
  const t = useTranslations("setup.access");
  const tSetup = useTranslations("setup");
  const row = matrix[roleId] ?? {};

  const toggle = (module: CrmModule, action: CrmAction) => {
    if (!locked) onChange(module, toggleAction(row[module], action));
  };

  return (
    <div className="overflow-x-auto">
      {locked ? <p className="mb-3 text-xs text-muted-foreground">{t("superAdminLocked")}</p> : null}
      <table className="w-full min-w-[560px] text-xs">
        <thead>
          <tr className="border-b border-border/60">
            <th className="px-1.5 py-2 text-left font-medium text-oboya-blue-dark">{t("module")}</th>
            {CRM_ACTIONS.map((action) => (
              <th key={action} className="px-1.5 py-2 text-center font-normal text-muted-foreground">
                {tSetup(`actions.${action}`)}
              </th>
            ))}
            <th className="px-1.5 py-2 text-right font-normal text-muted-foreground">{t("presets")}</th>
          </tr>
        </thead>
        <tbody>
          {CRM_MODULES.map((mod) => {
            const actions = levelToActions(row[mod]);
            const label = tSetup(`modules.${mod}`);
            return (
              <tr key={mod} className="border-b border-border/40">
                <td className="px-1.5 py-2 font-medium text-oboya-blue-dark">{label}</td>
                {CRM_ACTIONS.map((action) => (
                  <td key={action} className="px-1.5 py-2 text-center">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--oboya-blue)]"
                      checked={actions.includes(action)}
                      disabled={locked}
                      onChange={() => toggle(mod, action)}
                      aria-label={`${label}: ${tSetup(`actions.${action}`)}`}
                    />
                  </td>
                ))}
                <td className="px-1.5 py-2 text-right">
                  <div className="inline-flex gap-1">
                    {(["full", "none"] as const).map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        disabled={locked}
                        onClick={() => onChange(mod, preset)}
                        aria-label={`${label}: ${t(preset)}`}
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] tracking-wide uppercase",
                          locked
                            ? "text-muted-foreground"
                            : preset === "full"
                              ? "text-oboya-blue hover:bg-oboya-blue/10"
                              : "text-oboya-orange hover:bg-oboya-orange/10"
                        )}
                      >
                        {t(preset)}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
