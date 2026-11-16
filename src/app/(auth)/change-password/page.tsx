import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ChangePasswordForm } from "./ChangePasswordForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("changeTitle") };
}

/** The proxy only lets signed-in users reach this page. */
export default function ChangePasswordPage() {
  return <ChangePasswordForm />;
}
