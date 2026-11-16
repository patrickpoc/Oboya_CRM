import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
  // Service-role client only in admin-only server code, the inbound endpoint
  // and scripts (AGENTS.md rule 7). Everything else uses the user-scoped client.
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/lib/supabase/admin",
                "**/lib/supabase/admin",
                "**/supabase/admin",
                "./admin",
              ],
              message:
                "The service-role client is allowed only in src/lib/crm/server/admin-only/**, src/app/api/inbound/** and scripts/.",
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[property.name='SUPABASE_SERVICE_ROLE_KEY'], MemberExpression[property.value='SUPABASE_SERVICE_ROLE_KEY']",
          message:
            "SUPABASE_SERVICE_ROLE_KEY is read only in src/lib/supabase/admin.ts, src/lib/crm/server/admin-only/**, src/app/api/inbound/** and scripts/.",
        },
      ],
    },
  },
  {
    files: [
      "src/lib/crm/server/admin-only/**",
      "src/app/api/inbound/**",
      "scripts/**",
      // Test suites need the service role for fixtures/teardown (never shipped).
      "tests/**",
      "e2e/**",
    ],
    rules: {
      "no-restricted-imports": "off",
      "no-restricted-syntax": "off",
    },
  },
  {
    files: ["src/lib/supabase/admin.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
