# Expert review — tasks for the domain expert

Everything in this folder is work only the domain expert can do. Nothing here
needs programming. When these tasks are done, PRD milestone 1 ("trusted
benchmark engine") is complete.

| # | Task | File | Status |
|---|---|---|---|
| 1 | Confirm or correct the 49 **draft** mandatory/recommended labels | `provenance_review.csv` | pending |
| 2 | Label the 31 **unclassified** benchmarks as mandatory or recommended | `provenance_review.csv` | pending |
| 3 | Add a **citation** (document + clause, e.g. "EU GMP Annex 1 §4.12") for each benchmark | `provenance_review.csv` | pending |
| 4 | Write 2–3 **reference facilities** with the verdicts you expect | `reference-cases/` | pending |

## Tasks 1–3: the review sheet

Open `provenance_review.csv` in Excel or Google Sheets. One row = one benchmark
under one authority.

- Read-only columns (generated): `benchmark_id`, `authority`, `current_obligation`,
  `obligation_status` (`draft` = guessed from wording, `unclassified` = no guess),
  `draft_basis` (the wording behind the guess), `current_citation`, `citation_status`.
- **Fill these columns:**
  - `expert_obligation` — `mandatory` or `recommended`
  - `expert_citation` — the source document and clause
  - `reviewed_by` — your name
  - `reviewed_on` — date, `YYYY-MM-DD`

Leave a row's expert columns empty to keep it as it is. Save as CSV, then the
developer runs:

```bash
python3 scripts/build_provenance.py   # applies your edits to data/provenance.json
npm test                              # confirms nothing broke
```

Your edits are marked "expert confirmed" and survive every later re-run. In the
app, "(draft)" and "Citation pending expert review" disappear for every row you
complete.

Benchmark IDs: `THR-…` thresholds are in `data/thresholds.json`, `THR-B…` are
checklist items, `AREA-Z-…` are room minimum areas (room IDs in `data/rooms.json`).

## Task 4: reference facilities

See `reference-cases/README.md`. Each case is a facility you have assessed by
hand; the test suite fails if the engine disagrees with you. This is the last
open acceptance check for milestone 1.
