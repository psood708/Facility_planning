# Milestone 2 — Accounts & saved projects (approved plan, Gate 1: 2026-11-24)

PRD: `.claude/prds/pharma-facility-compliance-platform.prd.md#step-2` · Branch: `feat/accounts-saved-projects`

## Decisions (user-approved)
- Backend: Supabase (Postgres + Auth + RLS), browser calls supabase-js; site stays static. Region: Mumbai `ap-south-1`.
- Hosting: Vercel (security headers in `vercel.json`).
- Sign-in: one-time email link (magic link) only. Single use, 1-hour expiry, rate-limited. No passwords.
- Retention: clock = last **edit** (opening does not reset). 6 months after last edit → flagged. **30-day grace** → permanent hard delete.
- Deletion must be highlighted prominently: red list badge + date + days left (sorted to top), full-width banner on open, "Keep this project" (counts as edit → un-flag), amber hint within 30 days of flagging.
- Warning emails: NOT in this milestone (in-app only). README + PRD must state the limitation.
- Results: store inputs + data/engine versions + snapshot (ids/statuses only). Reopen: versions match → recompute, must equal snapshot; differ → snapshot read-only + "benchmark data updated" banner + Re-evaluate.
- DB tests: real local Supabase (`npx supabase start`, Docker) via `npm run test:db`; `@supabase/supabase-js` devDependency pinned to the vendored browser version.

## Tasks (order: T1–T3 → T7–T8 → T4–T6 → T9–T11 → T12)
| # | Task | Test first | Docker | Status |
|---|---|---|---|---|
| T1 | `data/manifest.json` (sha256 per data file + content_hash); `ENGINE_VERSION` | manifest matches files; engine version = package version | no | done |
| T2 | `project-state.js`: serializeInputs / validateInputs / resetState | round trip; R6 rejections | no | done |
| T3 | Remove `h()` html branch | static innerHTML scan (R8); `<img onerror>` stays text (R7) | no | done |
| T4 | `supabase/` config (magic link), migration (tables, CHECKs, trigger, indexes, RLS enable+force), seed | RLS coverage; trigger blocks owner/created/retention edits (R4/R5) | yes | done |
| T5 | Two-user isolation tests | R1 404-equivalent, R2 list, R3 anon, R4 forged owner → acceptance 1 | yes | done |
| T6 | `flag_expired_projects(p_now)` + `purge_flagged_projects(p_now)` + edit un-flags; pg_cron | 6mo±1d; idempotent; edit un-flags; delete day 30 not 29 → acceptance 3 | yes | done |
| T7 | `store.js` (injectable client) | fake client: missing/RLS-empty → null; validate before send | no | done |
| T8 | `results-snapshot.js` buildSnapshot / reconcile | save→reopen→recompute equals snapshot → acceptance 2 | no | done |
| T9 | Auth UI (magic link) + router, vendored supabase-js + SRI, `config.js` (public URL + anon key only) | routeFor(); no tokens in URLs (R15) | no | pending |
| T10 | Projects UI: list/new/open/save, stale banner, deletion highlighting | DB round trip; pure render tests for each retention state | partly | pending |
| T11 | `.env.example`, `.gitignore`, `vercel.json` headers | secret scan (R20); CSP checks (R13) | no | pending |
| T12 | README + PRD update (retention rule, email limitation) | — | — | pending |

## Out of scope
Team collaboration; warning emails; report export; server-side engine; SSO/MFA; auto-recompute of old snapshots.

## User actions required
Start Docker Desktop before T4. Create hosted Supabase project (Mumbai) + Vercel project; no credentials in repo.
