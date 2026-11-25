# Results page redesign (approved 2026-11-26)

Source: critique by three specialists (a11y-architect, data-visualisation critic, client-reader role-play) of the live Step 4 page. Branch: `feat/accounts-saved-projects`.

## Decisions (user-approved)
- **Fix list = one list ranked by severity** (Critical → Significant → Minor), then authorities satisfied, then label. Mandatory / Recommended / Not yet classified becomes a **tag** on each fix, with a "Mandatory only" filter. Advisory (international-standard-only) stays a separate, quiet group at the end. *(Supersedes the Milestone 4 grouping.)*
- **Page opens with the verdict per market** (plain words) + an authority × severity matrix. The primary authority keeps its own detailed section further down (problems first) and stays the switcher default. *(Supersedes Milestone 3 "leads with the primary authority".)*
- **Build all of it, in three phases**, each test-first, reviewed, committed separately; the export (`report-export.js`) must keep matching the screen.

## Keep
Glyph + colour + word for every status; "View as table" behind every chart; concrete suggested changes; "Satisfies N of 6"; range charts; the completeness caveat (next to the headline); "Your target".

## Phase 1 — structure, headline, vocabulary, honest counts
1. Order: verdict per market (plain line each, targets first, country names e.g. "China (NMPA)") → completeness ("3 of 31 checks have values") → top fixes (top 3 + Show all) → room grid → range charts → per-authority detail → primary-authority evidence tables last.
2. Evidence tables: per-room `<details>` with status counts; rooms with failures open; "No rule set"/"Needs value" rows folded.
3. One shared vocabulary map in results-model.js (used by views + export): verdicts Non-compliant / Has gaps / Meets / Not enough data; severities Critical / Significant / Minor; statuses Met / Not met / Needs value / No rule set.
4. Honest counts: completeness first; "N changes (M authority-gaps)"; never "0 of N met" when nothing checked; "(1 check)" on thin verdicts; empty-state panel.
5. Fix list per decision above; short title + full sentence; source as footnote; one note "Labels marked draft await expert confirmation".
6. Export follows the same structure and words.

## Phase 2 — charts
Authority × severity matrix at top (replaces stat row + severity bar); scorecard bars over checked values only; fix rows with severity rail + 6-cell "authorities unlocked" strip; room grid tinted by worst severity, gap rooms only, phone cards; range charts with neutral band, highlighted + labelled miss ("30 m² short"), no invented edges, merged identical limits.

## Phase 3 — accessibility details
Focus + live announcement after switcher/"Show all"; unique "View as table"/"Show all" names; regions only on overflowing scrollers; bars aria-hidden where text repeats; figcaption headings; amber ≥ 3:1 + outlines; forced-colors; sr-only authority names instead of `title`.

## Not possible yet
Cost/effort per fix — needs new data from the domain expert.

## Status
| Phase | Status |
|---|---|
| 1 | pending |
| 2 | pending |
| 3 | pending |
