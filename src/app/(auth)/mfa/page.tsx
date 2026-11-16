import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MfaForm } from "./MfaForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("mfaTitle") };
}

/** Reached from requireCrmAuth() when CRM_REQUIRE_MFA needs AAL2. Signed-in users only (proxy). */
export default function MfaPage() {
  return <MfaForm />;
}
