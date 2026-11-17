import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { EmailRecordButton } from "@/components/crm/email/EmailRecordButton";
import { RecordPage } from "@/components/crm/record/RecordPage";
import { requireCrmAuth } from "@/lib/crm/server/require-crm-auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("accounts");
  return { title: t("singular") };
}

/** Account record page (markViewed is called by RecordPage). */
export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { can } = await requireCrmAuth();
  const { id } = await params;
  return (
    <RecordPage
      object="account"
      id={id}
      slots={({ record }) => ({
        actionSlot:
          can("email", "view") && typeof record.email === "string" && record.email
            ? <EmailRecordButton email={record.email} recordId={id} recordType="account" />
            : undefined,
      })}
    />
  );
}
