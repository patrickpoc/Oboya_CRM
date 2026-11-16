import type { Metadata } from "next";
import { getLocale } from "next-intl/server";
import { Toaster } from "sonner";
import "@/app/globals.css";
import { CrmIntlProvider } from "@/contexts/CrmLocaleContext";
import { isLocale, defaultLocale } from "@/i18n/routing";
import { fontVariables } from "@/lib/fonts";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: {
    default: "Oboya CRM",
    template: "%s | Oboya CRM",
  },
  description: "Oboya Horticulture customer relationship management",
  robots: { index: false, follow: false },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const requested = await getLocale();
  const locale = isLocale(requested) ? requested : defaultLocale;

  return (
    <html lang={locale} className={cn(fontVariables, "h-full scroll-smooth")}>
      <body className="min-h-full bg-background font-body text-foreground antialiased">
        <CrmIntlProvider initialLocale={locale}>
          {children}
          <Toaster position="top-right" richColors />
        </CrmIntlProvider>
      </body>
    </html>
  );
}
