"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import {
  LOCALE_COOKIE,
  locales,
  localeLabels,
  type Locale,
} from "@/i18n/routing";
import enMessages from "@/../messages/en/index";
import ptBRMessages from "@/../messages/pt-BR/index";
import esMessages from "@/../messages/es/index";
import zhCNMessages from "@/../messages/zh-CN/index";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const MESSAGE_CATALOG: Record<Locale, AbstractIntlMessages> = {
  en: enMessages as unknown as AbstractIntlMessages,
  "pt-BR": ptBRMessages as unknown as AbstractIntlMessages,
  es: esMessages as unknown as AbstractIntlMessages,
  "zh-CN": zhCNMessages as unknown as AbstractIntlMessages,
};

export const CRM_LOCALE_SHORT: Record<Locale, string> = {
  en: "en",
  "pt-BR": "pt",
  es: "es",
  "zh-CN": "zh",
};

export const CRM_LOCALE_OPTIONS: { value: Locale; label: string; short: string }[] =
  locales.map((value) => ({
    value,
    label: localeLabels[value],
    short: CRM_LOCALE_SHORT[value],
  }));

interface CrmLocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const CrmLocaleContext = createContext<CrmLocaleContextValue | null>(null);

/**
 * Ported from the reference AdminIntlProvider. The locale lives in the
 * NEXT_LOCALE cookie (read by src/i18n/request.ts on the server), so the
 * server renders the right language on first paint and there is no flash.
 */
export function CrmIntlProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next);
      document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(next)}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
      document.documentElement.lang = next;
      // Re-render server components (metadata, server-side translations).
      router.refresh();
    },
    [router]
  );

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);

  return (
    <CrmLocaleContext.Provider value={value}>
      <NextIntlClientProvider
        key={locale}
        locale={locale}
        messages={MESSAGE_CATALOG[locale]}
        timeZone="UTC"
      >
        {children}
      </NextIntlClientProvider>
    </CrmLocaleContext.Provider>
  );
}

export function useCrmLocale() {
  const ctx = useContext(CrmLocaleContext);
  if (!ctx) {
    throw new Error("useCrmLocale must be used within CrmIntlProvider");
  }
  return ctx;
}
