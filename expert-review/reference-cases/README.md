# Expert reference cases

Each `*.json` file here is one facility the domain expert has assessed by hand.
`tests/reference-cases.test.js` runs the engine on it and fails if any verdict
disagrees with the expert. This is the acceptance check for PRD milestone 1
("regression tests encode the domain expert's reference cases").

**Status:** no real cases yet — only `_template.json` (ignored by the runner).
The reference-case test is reported as *skipped* until the first case is added.

## Adding a case

1. Copy `_template.json` to a descriptive name, e.g. `osd-tablet-plant-ahmedabad.json`.
2. Fill `facility` with the wizard inputs (category, rooms, entered values).
   IDs come from `data/rooms.json` (`Z-…`), `data/parameters.json` (`HVAC-…`, `DIM-…`),
   and authority keys from `data/authorities.json` (`schedule_m`, `eu_gmp`, …).
3. List each verdict you expect in `expected`:
   - `benchmark`: threshold ID (`THR-…`), boolean check (`THR-B…`), room area (`AREA-<room>`), or grade (`GRADE-<room>`)
   - `room`: room ID, or `null` for facility-level benchmarks
   - `authority`: authority key (omit for `THR-B…` checklist items)
   - `status`: `compliant` · `non_compliant` · `not_regulated` · `not_covered` · `no_value`
   - optional `obligation`: `mandatory` · `recommended` · `unclassified`
   - optional `fallback_status`: verdict against the international/industry fallback
4. Optionally add `expected_rollup` (per-authority overall verdict).
5. Run `npm test`.

If the engine disagrees with you, that is either a data error (fix
`data/thresholds.json` / `data/provenance.json`) or a logic bug — both are
exactly what these cases exist to catch.
