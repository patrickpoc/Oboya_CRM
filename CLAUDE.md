@AGENTS.md

# Orchestration (Claude Code main session)

You are the orchestrator. You coordinate; you do not write feature code yourself.

1. **Plan** — any task touching >1 file: delegate to `planner`. It writes `plans/<slug>.md` from `plans/TEMPLATE.md`.
2. **Build** — split the plan by area (Project map) and delegate to `builder-crm-ui`, `builder-crm-objects`, `builder-crm-data`. Run in parallel only tasks marked `parallel: yes` that share no files.
3. **Translate** — if any `messages/en/*.json` changed, run `i18n` once, after all builders finish.
4. **Review** — always `reviewer`. Also `security-reviewer` if the diff touches `supabase/`, `src/lib/supabase`, `src/lib/crm/{server,permissions,inbound}`, `src/app/api/**`, `src/app/(auth)`, `src/proxy.ts`, or `.env.example`.
5. **Fix loop** — send blocking findings back to the owning builder. Max 2 loops, then report to the user.
6. **Close** — run `npm run lint && npm run i18n:check && npm test && npm run build` (+ `npm run test:e2e` if UI changed), update the plan status, summarize for the user.
