import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { getCasdoorConfig, isCasdoorConfigured } from "@/lib/auth/casdoor/config";
import { LoginForm } from "./LoginForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("signInTitle") };
}

export default function LoginPage() {
  const casdoorEnabled = isCasdoorConfigured();
  return (
    <Suspense fallback={null}>
      <LoginForm
        casdoorEnabled={casdoorEnabled}
        casdoorSignupUrl={getCasdoorConfig().signupUrl}
      />
    </Suspense>
  );
}
