import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowRight, Check, Link2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusPill } from "@/components/crm/common/StatusPill";
import { CrmPageHeader } from "@/components/crm/layout/CrmPageHeader";
import { getRoadmapModule, isRoadmapId } from "@/lib/crm/roadmap";
import { requireCrmAuth } from "@/lib/crm/server/require-crm-auth";

/** `export const generateMetadata = () => plannedModuleMetadata("quotes");` */
export async function plannedModuleMetadata(id: string): Promise<Metadata> {
  const t = await getTranslations("roadmap");
  if (!getRoadmapModule(id)) return {};
  return {
    title: t(`modules.${id}.title`),
    description: t(`modules.${id}.summary`),
  };
}

/** "To be done" page for a planned module of the roadmap registry. */
export async function PlannedModulePage({ id }: { id: string }) {
  await requireCrmAuth();
  const entry = getRoadmapModule(id);
  if (!entry) notFound();

  const t = await getTranslations("roadmap");
  const key = `modules.${id}`;
  const Icon = entry.icon;

  return (
    <div className="mx-auto max-w-5xl">
      <CrmPageHeader
        title={t(`${key}.title`)}
        description={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone="warning">
              {entry.status === "live" ? t("statusLive") : t("statusPlanned")}
            </StatusPill>
            <p className="text-sm text-muted-foreground">{t(`${key}.summary`)}</p>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader className="flex flex-row items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-oboya-green/10 text-oboya-green">
              <Icon className="size-5" aria-hidden />
            </span>
            <CardTitle className="text-base text-oboya-blue-dark">{t("aboutTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <p className="text-sm leading-relaxed text-oboya-blue-dark/85">
              {t(`${key}.description`)}
            </p>

            <section aria-labelledby="planned-capabilities">
              <h2
                id="planned-capabilities"
                className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {t("capabilitiesTitle")}
              </h2>
              <ul className="space-y-2.5">
                {entry.capabilityKeys.map((capability) => (
                  <li key={capability} className="flex items-start gap-2.5 text-sm text-oboya-blue-dark">
                    <Check className="mt-0.5 size-4 shrink-0 text-oboya-green" aria-hidden />
                    <span>{t(`${key}.capabilities.${capability}`)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </CardContent>
        </Card>

        <Card className="self-start">
          <CardHeader>
            <CardTitle className="text-base text-oboya-blue-dark">{t("dependenciesTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            {entry.dependencyKeys.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noDependencies")}</p>
            ) : (
              <ul className="space-y-4">
                {entry.dependencyKeys.map((dependency) => {
                  const reason = t(`${key}.dependencies.${dependency}`);
                  const linked = isRoadmapId(dependency) ? getRoadmapModule(dependency) : undefined;
                  return (
                    <li key={dependency} className="space-y-1">
                      {linked ? (
                        <Link
                          href={linked.href}
                          className="group inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-oboya-blue hover:text-oboya-blue-dark md:min-h-0"
                        >
                          <linked.icon className="size-4 shrink-0" aria-hidden />
                          {t(`modules.${dependency}.title`)}
                          <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
                          <span className="sr-only">({t("plannedModuleLink")})</span>
                        </Link>
                      ) : (
                        <p className="inline-flex items-center gap-2 text-sm font-semibold text-oboya-blue-dark">
                          <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                          {t(`external.${dependency}`)}
                        </p>
                      )}
                      <p className="text-xs leading-relaxed text-muted-foreground">{reason}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
