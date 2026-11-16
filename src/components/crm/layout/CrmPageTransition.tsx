"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { CrmLoadingOverlay } from "@/components/crm/layout/CrmLoadingOverlay";
import { useCrmLoading } from "@/components/crm/layout/CrmLoadingContext";

export function CrmPageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isLoading, showNow, clearForced } = useCrmLoading();
  const [visible, setVisible] = useState(true);
  const [displayPath, setDisplayPath] = useState(pathname);
  const [pending, startTransition] = useTransition();
  const [navigating, setNavigating] = useState(false);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
        return;
      }

      try {
        const url = new URL(href, window.location.origin);
        if (url.origin !== window.location.origin) return;
        if (url.pathname.startsWith("/api/")) return;
        if (url.pathname === pathname) return;
      } catch {
        return;
      }

      setNavigating(true);
      setVisible(false);
      showNow();
    };

    // Capture phase: Next's <Link> calls preventDefault before a bubble listener runs.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [pathname, showNow]);

  useEffect(() => {
    startTransition(() => {
      setDisplayPath(pathname);
      setNavigating(false);
      clearForced();
      requestAnimationFrame(() => setVisible(true));
    });
  }, [pathname, clearForced]);

  const showOverlay = isLoading || navigating || pending || !visible;

  return (
    <div className="relative min-h-[50vh]">
      <CrmLoadingOverlay active={showOverlay} />

      <div
        key={displayPath}
        className={cn(
          "transition-opacity duration-200 ease-out",
          visible && !navigating && !pending ? "opacity-100" : "opacity-70"
        )}
      >
        {children}
      </div>
    </div>
  );
}
