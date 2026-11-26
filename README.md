# Facility Compliance Platform

Checks a pharmaceutical facility design (dosage form, rooms, areas, grades, utilities) against regulator benchmarks: India Schedule M, US FDA, EU-GMP/PIC/S, WHO GMP and others with data. Each result cites its source and is marked mandatory or recommended. **All output is advisory.** It is not a validated regulatory tool or a compliance sign-off.

Planners sign in with an email link and save projects to their account. Product requirements: [`.claude/prds/pharma-facility-compliance-platform.prd.md`](.claude/prds/pharma-facility-compliance-platform.prd.md). Work the domain expert needs to do: [`expert-review/README.md`](expert-review/README.md).

## How it fits together

A static site, with no server of its own. The browser talks directly to Supabase (Postgres + Auth). Row level security in the database keeps each user's projects private.

| File | Role |
|---|---|
| `index.html`, `styles.css`, `app.js` | The page: design tokens and components, wizard, sign-in, projects list, project bar; `h()` builds HTML and `s()` builds SVG (neither can set inline styles or parse HTML) |
| `engine.js` | Rules engine (pure; `ENGINE_VERSION`) |
| `project-state.js` | Saving and loading wizard inputs; validates every saved payload before use |
| `results-snapshot.js` | Compact saved results; detects when data or the engine changed since saving |
| `results-model.js`, `results-view.js`, `results.css` | Step 4 charts: a pure model built from the compact snapshot (so live and saved results share one path), and the views: summary, a scorecard per authority, ranked fixes, room × authority grid, numeric range charts |
| `doc-reader.js`, `doc-lines.js`, `intake-vocab.js`, `intake-match.js`, `intake-view.js` | Fill from a PDF: read in the browser (pdf.js text layer, Tesseract OCR for scans), rebuild lines and tables, match to the dataset, review screen (see below) |
| `vendor/pdfjs-<version>/`, `vendor/tesseract-<version>/` | Self-hosted PDF reader and OCR engine, loaded only when a PDF is chosen (`scripts/vendor-ocr.js` refreshes them) |
| `store.js` | The only code that reads/writes projects in Supabase |
| `router.js`, `auth.js` | Hash routes, sign-in guard, email-link sign-in |
| `projects-view.js` | Projects list, banners, wizard validation/stepper helpers (pure, unit-tested) |
| `config.js` | Public Supabase URL + anon key (local stack values; the build replaces it) |
| `vendor/supabase-js-<version>.js` | Vendored client, loaded with an integrity hash |
| `data/*.json`, `data/manifest.json` | Benchmark data and its content hash |
| `supabase/` | Local stack config, migrations (tables, RLS, triggers, retention jobs), seed |
| `scripts/build.js` | Production build into `dist/` |
| `scripts/secret-scan.js`, `scripts/serve.js` | Secret scan; local server with production headers |
| `tests/`, `db-tests/`, `e2e/` | Unit, database and browser tests |

## Run it locally

Prerequisites: Node 20+, Docker Desktop.

```sh
npm install
npx supabase start          # local Postgres + Auth + Mailpit (first run pulls images)
python3 -m http.server 8000 --bind 127.0.0.1
```

Open http://127.0.0.1:8000. Sign-in emails arrive in Mailpit at http://127.0.0.1:54324. `npx supabase stop` shuts the stack down.

To run what production runs (only shipped files, CSP and security headers enforced):

```sh
LOCAL_BUILD=1 SUPABASE_URL=http://127.0.0.1:54321 \
  SUPABASE_ANON_KEY="$(npx supabase status -o env | sed -n 's/^ANON_KEY="\(.*\)"$/\1/p')" \
  npm run build
npm run serve:dist          # http://127.0.0.1:8000 with vercel.json headers
```

Without `config.js` (or without Supabase reachable at startup) the app runs as the original wizard, with saving switched off.

## Tests

| Command | Needs | Covers |
|---|---|---|
| `npm test` | nothing | Engine, validation, snapshots, store (fake client), routing, auth, views, DOM safety, build/headers/secret scan |
| `npm run test:db` | `npx supabase start` | Row level security with two real users, protected columns, CHECK constraints, retention jobs, store round trip |
| `npm run test:e2e` | stack + app on :8000 + Chromium | Real email-link sign-in, saving, deletion warnings, stale results, unsaved-changes prompt, isolation; plus an axe-core accessibility pass (WCAG 2.2 AA) and a no-sideways-scroll check on every screen at 390 and 1440 px |
| `npm run scan` | nothing | Secret scan of every tracked file |
| `npm run audit:high` | network | `npm audit --audit-level=high` |

For the browser tests, set `CHROME_PATH`, or run `npx playwright install chromium`. CI (`.github/workflows/ci.yml`) runs the unit tests, audit, secret scan, a placeholder production build and the database tests on every push. It does not run the browser tests yet.

## Filling the wizard from a PDF

Step 1 has an optional **Fill from a document** panel. Pick a PDF that describes the facility (a room data sheet, specification, printed report, scan or layout drawing):

- **Read on the planner's computer.** The PDF is never uploaded or stored. pdf.js reads the text of typed pages. Pages without text (scans, image-only drawings) are rendered and read with Tesseract OCR, up to 40 such pages. Limits: 25 MB, 200 pages.
- **Matched to the dataset's own names.** Values are found in four places:
  - tables, whether one row per room with units in the headers, or one row per room and parameter
  - `Parameter (Room): value` lines
  - "… in 'room' from value …" sentences
  - short labels on drawings

  Units are converted and the conversion is disclosed (sq ft → m², °F → °C, mmWC/inWC → Pa). Synonyms live in one editable file, `intake-vocab.js`.
- **Reviewed before anything changes.** Every value shows the page and line it came from, a confidence label (High/Medium/Low) and anything it would replace.
  - Only high-confidence new values start ticked.
  - Different values found for the same field are an unanswered choice.
  - Values that already match the project are only counted.
- **Applied only through validation.** "Fill the selected values" applies the ticked values through `ProjectState.validateInputs`, as a saved project is, so invalid values change nothing. Fields filled from a PDF say so in Step 3 until edited.

Quality depends on how documents word things. Drawings are best-effort, since their labels are scattered.

**AI later:** extraction goes through a small extractor contract (`intake-match.js`), so an opt-in, server-side AI extractor can add proposals to the same review screen. See [`.claude/plans/ai-intake-later.md`](.claude/plans/ai-intake-later.md). None is built yet.

## Reading the results page

- **Verdict by market first:** one plain line per market (your target markets first, named country-first, e.g. "China (NMPA)"). It sits next to how much was actually checked ("4 of 36 checks have values") and the headline ("4 changes (10 authority-gaps), 1 critical"). A verdict resting on one or two checks says so, and "0 of N met" is never shown when nothing was checked.
- **Gaps by authority and severity:** a small table with one row per market and Critical / Significant / Minor counts.
- **What to fix first:** one list, most severe first, then the change that satisfies the most authorities.
  - Each fix shows a severity rail, a Mandatory / Recommended / Not yet classified tag, a short title, the full suggested change, its source, and a strip of the six authorities filled where it closes a gap.
  - The top 3 are shown, with "Show all" for the rest; "Mandatory only" filters the list.
  - Advisory (international-standard-only) suggestions are a quiet collapsed group. They never affect a verdict.
- **Room by authority:** only rooms with a gap, with cells tinted by their worst gap; on phones, one card per room.
- **Entered values against each requirement:** each failing value against every authority's range. The miss is drawn and labelled ("30 m² short"), and a one-sided limit fades out instead of drawing an edge no authority set.
- **By authority:** one strip per authority. Its bar counts only checked values (met / not met); values that need a value or have no rule set are listed in words.
- **Evidence against your primary authority:** one collapsible section per room. Rooms with a failure open by default; requirements without a result are folded away.
- **Full detail:** every check, recommendation text and source, collapsed at the bottom.

Status is always a glyph and a word as well as colour. The words are the same on screen, in the saved view and in the downloaded report: Non-compliant / Has gaps / Meets / Not enough data; Critical / Significant / Minor; Met / Not met / Needs value / No rule set. Every chart has a "View as table" option.

## Accounts and data

- **Sign-in** is by one-time email link only: no passwords. A link works once and expires after an hour. The app answers the same way whether or not an address has an account. After sign-in, the code is removed from the address bar.
- **Privacy.** A user can only read, change or delete their own projects. This is enforced in the database (row level security, forced), not just in the page. Another user's project link shows "Project not found", exactly like a link that doesn't exist.
- **Saved results.** A project stores its inputs, a compact snapshot of its results (IDs and statuses only), and the data hash and engine version they were computed with. If the benchmark data or engine changes later, reopening the project shows the results *as saved*, read-only, with a **Re-evaluate with current data** button.
- **Unsaved changes.** The project bar shows "Unsaved changes". Leaving within the app asks Save, Discard or Stay, and closing the tab triggers the browser's own prompt.

### Retention

The clock is the project's **last edit**. Opening a project doesn't count.

| Time since last edit | What happens |
|---|---|
| under 5 months | nothing |
| 5–6 months | amber hint in the list and on the project: "marked for deletion on …" |
| 6 months | flagged: red badge (deletion date and days left), sorted to the top, full-width banner when opened |
| 6 months + 30 days | **permanently deleted** (daily job, 02:30 UTC) |

**Keep this project** (or any save) restarts the clock and clears the flag.

> **Known limitation: warnings are in-app only.** No warning emails are sent yet. A user who doesn't sign in during the 30-day grace period will lose the project without being told. Warning emails need a scheduled sender (e.g. a Supabase Edge Function on a cron) and are planned for a later milestone.

## When the benchmark data or engine changes

- After editing anything in `data/`, run `node scripts/manifest.js`. The tests fail if `data/manifest.json` doesn't match the data files. The script also stamps `data_date` (today) whenever the data's content changes, and keeps it otherwise; reports print it as "Benchmark data as of …".
- When evaluation logic in `engine.js` changes, bump `ENGINE_VERSION` and the `package.json` version together. A test checks they match.

Saved projects then show the stale-results banner until the user re-evaluates and saves.

## Deploying

**1. Supabase (production):** create a project in the **Mumbai (ap-south-1)** region, then:

```sh
npx supabase link --project-ref <project-ref>
npx supabase db push        # applies supabase/migrations (tables, RLS, triggers, retention jobs + pg_cron)
```

In the Supabase dashboard:
- **Authentication → URL Configuration:** Site URL = your production URL. Add it (and your Vercel preview URL pattern, if you use previews) to the Redirect URLs, or email links won't return to the app.
- **Authentication → Emails → SMTP:** set up **custom SMTP before any pilot user signs in.** Supabase's built-in sender only delivers to your own organization's team members, and is limited to about 2 emails an hour ([Supabase docs](https://supabase.com/docs/guides/auth/auth-smtp)). Without custom SMTP, users see "check your inbox" but never get the email: the app deliberately gives the same answer for every account-related error.
- Optionally edit the magic-link email template.

**2. Vercel:** import the repository. `vercel.json` runs `node scripts/build.js`, serves only `dist/`, and sends the security headers. Set two Environment Variables (Production, and Preview if used); see `.env.example`:
- `SUPABASE_URL`: `https://<project-ref>.supabase.co`
- `SUPABASE_ANON_KEY`: the anon / publishable key

- `TURNSTILE_SITE_KEY` (recommended): the Cloudflare Turnstile **site** key. This turns on the sign-in CAPTCHA, so nobody can use the form to flood inboxes. Put the matching **secret** key only in Supabase (**Authentication → Attack Protection → CAPTCHA → Turnstile**). Without a site key, no CAPTCHA is shown, as in local development.

The build fails if it's given a secret or service-role key, a non-Supabase URL, a malformed Turnstile key, or if anything secret-looking ends up in the output. **Never put the secret / service-role key in Vercel, the repo or the page.**

Each account can hold up to 200 saved projects (migration `20261126120000_project_cap.sql`). At the limit, the app asks the user to delete one before saving.

## Security notes

- **Headers:** CSP: scripts and styles from the site only (plus Cloudflare's Turnstile script and challenge frame for the sign-in CAPTCHA), no inline code, no framing of this site; `connect-src` is limited to Supabase and pinned to your project at build time. `'wasm-unsafe-eval'` lets the in-browser OCR compile WebAssembly; it does not allow `eval()`. Also HSTS, nosniff, Referrer-Policy, X-Frame-Options, Permissions-Policy and COOP.
- **Untrusted payloads:** saved payloads are validated before use (unknown keys, prototype keys, IDs not in the dataset, wrong value types and oversized fields are all rejected). The database repeats the size and format checks.
- **PDF intake:** the chosen PDF stays in the browser (no request carries it, and the OCR model isn't cached). Document text is treated as untrusted: it is shown only as text, and values reach the project only through `validateInputs`.
- **No HTML injection:** the page never turns text into HTML. A test fails if any script uses an HTML-parsing sink.
- **Locked columns:** clients can't set or change a project's owner, created date, last-edit date or deletion flag; database triggers enforce this.
