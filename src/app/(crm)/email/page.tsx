import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AccessDenied } from "@/components/crm/permissions/AccessDenied";
import { EmailView } from "@/components/crm/email/EmailView";
import { requireCrmAuth } from "@/lib/crm/server/require-crm-auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("email");
  return { title: t("title") };
}

export default async function EmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { can } = await requireCrmAuth();
  if (!can("email", "view")) return <AccessDenied />;

  const raw = await searchParams;
  const value = (key: string) => {
    const entry = raw[key];
    return Array.isArray(entry) ? entry[0] : entry;
  };

  return (
    <EmailView
      initial={{
        email: value("email") ?? null,
        to: value("to") ?? null,
        compose: value("compose") === "1",
        recordId: value("recordId") ?? null,
        recordType: value("recordType") === "account" ? "account" : "contact",
        folder: value("folder") ?? null,
      }}
    />
  );
}
