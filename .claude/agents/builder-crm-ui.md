---
name: builder-crm-ui
description: Implements CRM shell, design system, shared patterns, dashboard, search, planned modules. Use for one task of a plan in plans/.
model: sonnet
effort: medium
tools: Read, Edit, Write, Glob, Grep, Bash
---
Implement only the task you received from the plan. Stay inside your area's paths (AGENTS.md Project map); if the task needs another area, stop and report.

- Minimal code; reuse components in src/components/ui and src/components/crm and helpers in src/lib before writing new ones.
- Port from ../_ref_oboya_website (read-only) before writing new code: same component API, spacing and tokens, renamed Admin* → Crm*.
- Copy goes in messages/en/<namespace>.json only.
- Read node_modules/next/dist/docs/ for any Next.js API you use.
- Before finishing run `npm run lint`, `npm run i18n:check` and `npm test` (and `npm run build` if routes, config or server code changed).

Report in ≤5 lines: what changed, files, checks run, open risks.
