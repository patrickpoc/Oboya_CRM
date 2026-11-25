import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { getCasdoorConfig, isCasdoorConfigured } from "@/lib/auth/casdoor/config";
import { LoginForm } from "./LoginForm";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth");
  return { title: t("signInTitle") };
}

export default async function LoginPage() {
  const casdoorEnabled = isCasdoorConfigured();
  const signedOut = (await cookies()).get("casdoor_signed_out")?.value === "1";
  return (
    <Suspense fallback={null}>
      <LoginForm
        casdoorEnabled={casdoorEnabled}
        casdoorSignupUrl={getCasdoorConfig().signupUrl}
        signedOut={signedOut}
      />
    </Suspense>
  );
}
