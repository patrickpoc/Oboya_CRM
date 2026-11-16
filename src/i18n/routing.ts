import { defineRouting } from "next-intl/routing";

export const locales = ["en", "pt-BR", "es", "zh-CN"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

/** Cookie that stores the user's CRM language (next-intl's default name). */
export const LOCALE_COOKIE = "NEXT_LOCALE";

export const localeLabels: Record<Locale, string> = {
  en: "English",
  "pt-BR": "Português",
  es: "Español",
  "zh-CN": "中文",
};

export function isLocale(value: string | null | undefined): value is Locale {
  return Boolean(value && (locales as readonly string[]).includes(value));
}

// The CRM has no locale segment in its URLs: the locale comes from the cookie.
export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: "never",
  localeCookie: { name: LOCALE_COOKIE, maxAge: 60 * 60 * 24 * 365 },
});
