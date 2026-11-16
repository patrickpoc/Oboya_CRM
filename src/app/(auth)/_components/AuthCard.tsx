import { cn } from "@/lib/utils";

/** Card used by every auth page (same look as the reference admin auth pages). */
export function AuthCard({
  brand,
  title,
  subtitle,
  children,
  className,
}: {
  brand: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-full max-w-sm rounded-2xl border border-border/60 bg-white p-6 shadow-[var(--shadow-card)]",
        className
      )}
    >
      <p className="mb-4 flex items-center gap-2 font-display text-lg font-black tracking-tight text-oboya-blue">
        <span aria-hidden className="h-5 w-1.5 rounded-full bg-oboya-green" />
        {brand}
      </p>
      <h1 className="font-display text-xl font-semibold text-oboya-blue-dark">{title}</h1>
      {subtitle ? <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p> : null}
      {children}
    </div>
  );
}

export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="text-sm text-destructive" role="alert">
      {message}
    </p>
  );
}

/** Full-page navigation so the proxy reads the fresh session cookie. */
export function hardNavigate(path: string) {
  window.location.assign(path);
}
