import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ProfileSettings, type CasdoorLinkState } from "@/components/crm/profile/ProfileSettings";
import { getCasdoorLink } from "@/lib/crm/server/admin-only/casdoor-session";
import { requireCrmAuth } from "@/lib/crm/server/require-crm-auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("profile");
  return { title: t("title") };
}

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user, supabase } = await requireCrmAuth();
  const params = await searchParams;
  const first = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const [profileResult, authResult, linkResult] = await Promise.all([
    supabase
      .from("crm_users")
      .select("full_name, title, phone, locale")
      .eq("id", user.id)
      .maybeSingle<{ full_name: string; title: string | null; phone: string | null; locale: string }>(),
    supabase.auth.getUser(),
    // The profile page must render even before the Casdoor migration is applied.
    getCasdoorLink(user.id).catch(() => null),
  ]);

  const profile = profileResult.data;
  const metadata = (authResult.data.user?.user_metadata ?? {}) as Record<string, unknown>;
  const text = (key: string): string | null =>
    typeof metadata[key] === "string" && (metadata[key] as string).trim()
      ? (metadata[key] as string)
      : null;

  const initialLink: CasdoorLinkState = {
    linked: Boolean(linkResult),
    sub: linkResult?.sub ?? null,
    linkedAt: text("casdoor_linked_at"),
    email: text("casdoor_email"),
    displayName: text("casdoor_display_name"),
    title: text("casdoor_title"),
    country: text("casdoor_country"),
    countryCode: text("casdoor_country_code"),
    location: text("casdoor_location"),
    canUnlink: metadata.has_password === true,
  };

  return (
    <ProfileSettings
      initialFullName={profile?.full_name ?? user.fullName}
      initialTitle={profile?.title ?? null}
      initialPhone={profile?.phone ?? null}
      initialLocale={user.locale}
      initialLink={initialLink}
      notice={{ linked: first("linked") === "1", error: first("error") }}
    />
  );
}
