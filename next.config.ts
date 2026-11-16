import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

function supabaseImageHost(): string | null {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) return null;
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

const supabaseHost = supabaseImageHost();

// Strict set from the reference `/admin/:path*` rule, applied to the whole CRM.
// form-action 'self': every form submits via JS (fetch) or same-origin; there
// are no server actions posting elsewhere.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
];

const noStore = {
  key: "Cache-Control",
  value: "private, no-cache, no-store, must-revalidate",
};

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      {
        // Pages and API responses hold private CRM data: never cache them.
        // Hashed static assets and files with an extension keep Next's caching.
        source: "/((?!_next/static|_next/image|.*\\..*).*)",
        headers: [noStore],
      },
    ];
  },
  images: {
    remotePatterns: supabaseHost
      ? [
          {
            protocol: "https",
            hostname: supabaseHost,
            pathname: "/storage/v1/object/public/**",
          },
        ]
      : process.env.NODE_ENV === "development"
        ? [
            {
              protocol: "https",
              hostname: "*.supabase.co",
              pathname: "/storage/v1/object/public/**",
            },
          ]
        : [],
  },
};

export default withNextIntl(nextConfig);
