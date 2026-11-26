# Plan: Fill the facility from a PDF (in-browser reading + OCR, review before filling)

## Summary
A planner uploads a PDF (typed room-data sheet or URS, scanned paper, or a layout drawing). The browser reads it on the planner's own computer: pdf.js takes the text layer, and Tesseract.js OCRs pages that have no text. Rule-based matching against the dataset's own vocabulary turns the text into proposed values for category, forms, markets, rooms and room or facility parameters. A review screen shows every proposed value with its source line and a confidence label. Nothing is filled until the planner confirms. The matching sits behind a small extractor contract, so an AI extractor (opt-in, server-side) can be added later without touching the review or apply code.

## User Story
As a facility planner, I want to upload the PDF that already describes my facility and have its values proposed into the wizard, so that I don't retype dozens of room areas, grades, temperatures and pressures by hand.

## Problem → Solution
Today every value is typed across Steps 1–3 (up to 57 rooms × ~20 parameters). → Upload one PDF. Most values are proposed with their source shown, the planner ticks or unticks them, and the wizard is filled through the same validation a saved project goes through.

## Metadata
- **Complexity**: Large (new subsystem, two vendored libraries, CSP change, ~16 files)
- **Source PRD**: N/A (free-form request; relates to `.claude/prds/pharma-facility-compliance-platform.prd.md`)
- **PRD Phase**: N/A
- **Estimated Files**: 9 new, 9 updated (+ vendored library files)

## Decisions (user-confirmed 2026-11-26)
- **Documents**: typed PDFs with tables, scanned paper and drawings/layouts are all supported. Drawings are best-effort, see Risks.
- **Processing**: in the browser only. The file never leaves the computer; no cloud OCR in this plan.
- **Filling**: always through a review screen; nothing is changed silently.
- **AI**: define the extractor contract now and build the AI extractor later (it is NOT built in this plan).
- **Stack**: stays vanilla JS under the strict CSP (Next.js migration declined, 2026-11-26).

---

## UX Design

### Before
```
Step 1  pick category · forms · markets · primary         (typed by hand)
Step 2  tick rooms from 57                                 (by hand)
Step 3  per room: area, grade, temp, RH, pressure, ACH…    (by hand, ~20 fields × N rooms)
```

### After
```
Step 1
┌──────────────────────────────────────────────────────────────┐
│ Fill from a document (optional)                              │
│ [ Choose PDF… ]   Read on this computer — never uploaded.    │
│ Typed PDFs, scans and layout drawings · up to 25 MB, 40 pp   │
└──────────────────────────────────────────────────────────────┘
        │ choose file
        ▼
┌──────────────────────────────────────────────────────────────┐
│ Reading "Plant2-RDS.pdf" — page 3 of 8 (scanned, reading…)   │
│ ▓▓▓▓▓▓▓░░░░░░░░   [ Cancel ]                                 │
└──────────────────────────────────────────────────────────────┘
        ▼
┌──────────────────────────────────────────────────────────────┐
│ Review what was found (34 values on 8 pages)                 │
│ [Select all high-confidence]  [Clear all]                    │
│                                                              │
│ Facility                                                     │
│ [x] Category       Sterile          p.1 "Sterile injectables"   High │
│ [x] Markets        US FDA, EU-GMP   p.1 "for USFDA and EU GMP"  High │
│                                                              │
│ Aseptic Filling Suite (Vials/Ampoules/PFS/Cartridge)         │
│ [x] Room Net Area  120 m²   now: —   p.3 "Filling 120 m² …"   High  │
│ [x] Cleanroom grade Grade B now: —   p.3 "… Grade B"          High  │
│ [ ] Temperature    19–24 °C now: 20–22 °C   p.3 …   Medium (differs) │
│ ( ) 18 °C  ( ) 19–24 °C  ← two different values found        │
│                                                              │
│ Not matched (5 lines)  ▸ shows lines we couldn't place       │
│                                                              │
│ [ Fill the selected 31 values ]   [ Discard ]                │
└──────────────────────────────────────────────────────────────┘
        ▼
"31 values filled from Plant2-RDS.pdf. Check them in Steps 1–3."
(rooms added to Step 2; filled fields get a small "from PDF p.3" note in Step 3)
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Step 1 | Form only | Adds an optional "Fill from a document" panel above the form | The file input has a visible label; the privacy note is always shown |
| Reading | — | Progress per page with Cancel; a live status line announces each page | Cancel terminates the workers; nothing is changed |
| Review | — | Grouped list of proposed values, each with a checkbox, current vs found value, source snippet, confidence word | High is ticked by default, Medium/Low unticked; conflicts are radio choices |
| Apply | — | One button fills all ticked values via `validateInputs`; focus moves to a summary; announced | Values that would replace an existing one are listed as "replaces …" |
| Step 3 | — | Fields filled from the PDF show a note "From <file> p.N" until edited | The note is session-only, not saved |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `project-state.js` | 14–31, 33–42, 86–113, 115–191 | Form vocabulary (`CATEGORY_DEFS`, `SPECIFIC_FORMS`, `DEV_STAGES`, `SCALE_SIZES`), `resolveInputKind`, `checkValue` rules, `validateInputs`. Apply MUST go through `validateInputs` |
| P0 | `app.js` | 15–19 (`OPTION_OVERRIDES`), 50–67 (`h()`), 230–248 (`renderStep1`), 459–470 (`relevantParams`, `optionsFor`), 561–610 (`renderStep3`), 969–974 (`announce`), 1007 (`showStep`) | Where the panel and review mount, how select options are derived, the DOM builder rules |
| P0 | `vercel.json` | headers | The CSP that must change (adds `'wasm-unsafe-eval'`) |
| P0 | `scripts/build.js` | 53–70, 105 | `shippedFiles()` copies only what `index.html` references, so vendored OCR files must be added; the CSP is copied into a meta tag |
| P1 | `tests/deploy.test.js` | 35–50, 95–105 | Asserts `script-src` exactly `['self']`; update to the new policy |
| P1 | `results-model.js` | 14–20, 37–45 | UMD module pattern; untrusted-input guards (`hasOwn`, `list`) |
| P1 | `results-view.js` | 15–20, `rankedList`, `setKids` | Pure view taking `h`, live status pattern, `setKids` |
| P1 | `tests/results-model.test.js` | 1–30 | Test file shape: `node:test`, `assert/strict`, `loadData()` from `tests/helpers.js` |
| P1 | `e2e/lib.js` | all (70 lines) | `launch`, `signIn`, `uniqueEmail`, `check` for browser tests |
| P2 | `engine.js` | `relevantParams`, `appliesAtNormalized`, `PARAM_ROOM_FILTERS` | Which parameters apply to which room |
| P2 | `scripts/secret-scan.js` | 41–45 | Binary files are skipped (`buf.includes(0)`); large `.mjs`/`.wasm.js` text files are scanned, so check run time |
| P2 | `data/parameters.json`, `data/rooms.json`, `data/authorities.json` | — | 59 parameters (`data_type`, `unit_options`, `applies_at`), 57 rooms (`id`, `name`, `applies_to`), 11 authorities (`key`, `label`, `covered`) |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| Tesseract.js local install | https://unpkg.com/tesseract.js@6.0.1/docs/local-installation.md | Set `workerPath`, `corePath` (a directory holding all core variants) and `langPath`. Language file = `langPath + code + '.traineddata.gz'` |
| Tesseract.js under CSP | https://github.com/naptha/tesseract.js/issues/961, https://groups.google.com/a/chromium.org/g/chromium-extensions/c/DYLu4kajmPc | WASM needs `'wasm-unsafe-eval'`. The default blob-URL worker is blocked by strict CSPs, so use `workerBlobURL: false` with a self-hosted `workerPath` |
| pdf.js releases | https://github.com/mozilla/pdf.js/releases, https://npmjs.com/package/pdfjs-dist | ESM-only builds (`pdf.min.mjs`, `pdf.worker.min.mjs`). Load with dynamic `import()` from `'self'`; pass `isEvalSupported: false` |

```
KEY_INSIGHT: tesseract.js 7.0.0 (npm, 2025-12-15, Apache-2.0) depends on tesseract.js-core ^7.0.0; pdfjs-dist 6.5.438 (npm, 2026-11-01, Apache-2.0).
APPLIES_TO: Task 1 (vendoring)
GOTCHA: `npm view tesseract.js-core version` shows 6.1.2 as latest while tesseract.js 7 needs ^7.0.0. Install tesseract.js@7.0.0 and vendor the core version npm actually resolves into node_modules, not "latest".

KEY_INSIGHT: getTextContent() returns items with a transform matrix; x = transform[4], y = transform[5] (PDF units, origin bottom-left). Sorting by -y then x and grouping by y tolerance rebuilds lines; consistent x starts rebuild table columns.
APPLIES_TO: Task 3 (doc-lines.js)
GOTCHA: Rotated pages and drawings carry rotated text items (transform[1] != 0). Skip items whose rotation is > 5° when building table rows, but keep them for keyword search.

KEY_INSIGHT: Tesseract recognize() returns words with bbox and confidence (0–100), usable in the same line or column builder as pdf.js items.
APPLIES_TO: Tasks 2–3
GOTCHA: Render scanned pages at ~2.5–3× scale (≈300 DPI). Lower loses small table text; higher is slow and memory-heavy on phones.
```

---

## Patterns to Mirror

### NAMING_CONVENTION / MODULE SHAPE
```js
// SOURCE: results-model.js:14-19 — kebab-case file, UMD, window.<PascalName> in the browser
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod;
  else root.ResultsModel = mod;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  ...
  return { build, numericGaps, forAuthority };
});
```
New modules: `doc-lines.js` → `DocLines`, `intake-vocab.js` → `IntakeVocab`, `intake-match.js` → `IntakeMatch`, `intake-view.js` → `IntakeView`, `doc-reader.js` → `DocReader` (browser-only).

### UNTRUSTED INPUT GUARDS
```js
// SOURCE: results-model.js:37-41
const list = (v) => (Array.isArray(v) ? v.filter((x) => !!x && typeof x === "object") : []);
const verdictKeyOf = (v) => (Object.prototype.hasOwnProperty.call(VERDICT_KEY, v) ? VERDICT_KEY[v] : "insufficient");
```
PDF text is untrusted. Use `hasOwn` for every lookup keyed by document text; never build an object key from raw text without `FORBIDDEN_KEYS` (project-state.js:30).

### DOM (no HTML strings)
```js
// SOURCE: app.js:50-67 — h() rejects "html" and string handlers; text always becomes a text node
if (k === "html") throw new Error('h(): "html" is not supported; pass text or elements as children');
```
Snippets from the PDF are shown only as text children.

### VALIDATION GATE (the only way values enter state)
```js
// SOURCE: project-state.js:137-191 — returns a fresh validated copy or errors
const r = ProjectState.validateInputs(candidateInputs, DATA);
if (!r.ok) { /* show r.errors, change nothing */ }
else ProjectState.resetState(state, r.inputs);   // resetState copies known fields one by one
```

### VALUE KINDS
```js
// SOURCE: project-state.js:86-113 — what each parameter accepts
number → finite number; number-range → {min,max}; boolean → true/false;
boolean-text → {value, text}; select → one of optionsFor(param); text → string ≤ 2000
// select options: app.js:465-470 optionsFor(param) (OPTION_OVERRIDES first, else unit_options split on " / ")
```
GOTCHA: `optionsFor` lives in app.js, but `intake-match.js` needs it in Node tests. Move it, with `OPTION_OVERRIDES`, into `project-state.js` as `ProjectState.optionsFor(param)` and keep app.js calling it (Task 4).

### LIVE STATUS / FOCUS
```js
// SOURCE: results-view.js rankedList — sr-only role=status updated via setKids
const status = h("p", { class: "sr-only fix-filter-status", role: "status" }, "");
setKids(status, [`Showing ${n} mandatory changes.`]);
// SOURCE: app.js:969 announce(text) → #app-status (global announcements)
```

### LOGGING
No logging library; the app doesn't log in production (no `console.log` in app code). Errors surface to the user as text (`renderMessage`, `field-hint`). Mirror that: no `console.*` with document content.

### TEST_STRUCTURE
```js
// SOURCE: tests/results-model.test.js:1-20
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadData, makeState, engine } = require("./helpers.js");
const DATA = loadData();
test("…", () => { … assert.deepEqual(…); });
```
View tests use the plain-object `h` from `tests/results-view.test.js:20-35` (`mk`, `text`, `all`, `find`, `cls`).

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `vendor/pdfjs-6.5.438/pdf.min.mjs`, `pdf.worker.min.mjs` | CREATE (vendored) | PDF text layer and page rendering, self-hosted (CSP `'self'`) |
| `vendor/tesseract-7.0.0/tesseract.min.js`, `worker.min.js`, `core/*` (all `tesseract-core*.wasm.js` variants), `lang/eng.traineddata.gz` | CREATE (vendored) | OCR, self-hosted; lazy-loaded only when a page has no text |
| `scripts/vendor-ocr.js` | CREATE | Copies the vendored files from `node_modules` and prints hashes, so updates are one command |
| `doc-reader.js` | CREATE | Browser-only: loads pdf.js and Tesseract on demand, reads pages, returns normalized items; progress and cancel |
| `doc-lines.js` | CREATE | Pure: items → lines → table rows/columns (works for pdf.js and OCR items) |
| `intake-vocab.js` | CREATE | Pure: synonyms for categories, forms, authorities, rooms, parameter headers, grades and units (expert-extendable) |
| `intake-match.js` | CREATE | Pure: the rule extractor (lines → candidates), the extractor contract, conflict resolution, `buildInputs(state, accepted)` |
| `intake-view.js` | CREATE | Pure view: upload panel, progress, review screen, summary |
| `tests/doc-lines.test.js`, `tests/intake-match.test.js`, `tests/intake-view.test.js` | CREATE | Unit tests with item fixtures |
| `tests/fixtures/intake/*.json` | CREATE | Normalized item fixtures (typed table, OCR noise, drawing labels) |
| `e2e/intake.e2e.js` | CREATE | Real upload in Chromium (PDFs generated in-test): typed PDF, scanned PDF, cancel, not-a-PDF, axe, CSP |
| `project-state.js` | UPDATE | Move `OPTION_OVERRIDES` + `optionsFor` here (exported) |
| `app.js` | UPDATE | Mount the panel in Step 1, run the reader, show review, apply, Step 3 notes |
| `index.html` | UPDATE | Script tags for `doc-lines.js`, `intake-vocab.js`, `intake-match.js`, `intake-view.js`, `doc-reader.js` (not the vendored libs: those lazy-load) |
| `styles.css` | UPDATE | `.intake-*` panel, progress and review list (classes only) |
| `vercel.json` | UPDATE | `script-src 'self' 'wasm-unsafe-eval'`; `worker-src 'self'` explicit |
| `scripts/build.js` | UPDATE | Copy `vendor/pdfjs-*/` and `vendor/tesseract-*/` into dist (`shippedFiles` only follows `index.html` today) |
| `tests/deploy.test.js` | UPDATE | New CSP expectations; build output includes the vendored files |
| `package.json` | UPDATE | `pdfjs-dist@6.5.438`, `tesseract.js@7.0.0`, `@tesseract.js-data/eng@1.0.0` as devDependencies (source of the vendored copies); `test:e2e` adds `e2e/intake.e2e.js` |
| `README.md` | UPDATE | Feature description, privacy statement, supported documents, limits; AI slot (Task 10) |

## NOT Building

- **AI extraction or summarisation.** Only the extractor contract and a documented slot (see Task 10). No API keys, server function or model calls.
- **Cloud OCR** (Google Document AI, AWS Textract).
- **Saving the PDF or its text.** Nothing is uploaded or stored, and the "from PDF" notes are session-only.
- **Non-English OCR.** Only `eng` traineddata is vendored; more languages can be added later.
- **Word, Excel or image uploads.** PDF only; a JPG/PNG of a scan can be printed to PDF.
- **Reading values from drawing geometry** (room polygons, scale bars). Drawings contribute text labels only.
- **Editing values inside the review screen.** The planner unticks a wrong value and edits it in Step 3 after filling.
- **Auto-picking the primary authority.** It stays a Step 1 choice; filling only suggests target markets (and keeps or defaults the primary per Task 6).

---

## Extractor contract (the AI slot)

```js
// intake-match.js
// An extractor turns a read document into candidates. The rule extractor ships
// now; an AI extractor (server-side, opt-in) can implement the same shape later.
//
// extractor = { id: "rules", label: "Built-in rules", run(doc, ctx) -> Candidate[] }
//   doc = { name, pages: [{ index, source: "text"|"ocr", lines: Line[] }] }
//   ctx = { DATA, vocab }
// Candidate = {
//   target: { kind: "category" } | { kind: "form" } | { kind: "devStage" } | { kind: "market" }
//         | { kind: "room" }                                  // select this room (target.roomId)
//         | { kind: "param", scope: "facility", paramId }     // facilityValues[paramId]
//         | { kind: "param", scope: "room", roomId, paramId }, // roomValues[roomId][paramId]
//   value,            // already in the shape checkValue accepts (number, {min,max}, option string, boolean…)
//   display,          // human text, e.g. "120 m²", "19–24 °C", "Grade B"
//   source: { page, text },   // the line it came from (text only, ≤ 200 chars)
//   confidence: "high" | "medium" | "low",
//   reason,           // e.g. "table column 'Area (m²)'", "keyword 'Grade' + room name on same line"
//   converted: null | "from 1,292 sq ft" // unit conversions are always disclosed
// }
```
Rules for any future extractor: it returns candidates only, which go through the same review and `validateInputs` path. It never writes state.

---

## Step-by-Step Tasks

### Task 1: Vendor pdf.js and Tesseract.js; open the CSP for WASM only
- **ACTION**: Pin and self-host both libraries; allow WASM under the CSP.
- **IMPLEMENT**:
  - `npm i -D pdfjs-dist@6.5.438 tesseract.js@7.0.0 @tesseract.js-data/eng@1.0.0`.
  - `scripts/vendor-ocr.js` copies into `vendor/` and prints sha384 hashes:
    - `node_modules/pdfjs-dist/build/pdf.min.mjs` and `pdf.worker.min.mjs` → `vendor/pdfjs-6.5.438/`
    - `node_modules/tesseract.js/dist/tesseract.min.js` and `worker.min.js` → `vendor/tesseract-7.0.0/`
    - every `node_modules/tesseract.js-core/tesseract-core*.wasm.js` → `vendor/tesseract-7.0.0/core/`
    - the `eng.traineddata.gz` inside `node_modules/@tesseract.js-data/eng/` (use the `*_best_int` folder; check the actual name) → `vendor/tesseract-7.0.0/lang/`
  - `vercel.json` CSP: `script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'` (everything else unchanged).
  - `scripts/build.js`: copy the `vendor/pdfjs-*` and `vendor/tesseract-*` directories recursively into `dist/`.
- **MIRROR**: `vendor/supabase-js-2.119.0.js` (versioned names); the CSP stays explicit, with no `unsafe-eval` and no `unsafe-inline`.
- **GOTCHA**:
  - `'wasm-unsafe-eval'` allows WASM compilation only; never add `'unsafe-eval'`.
  - The secret scanner reads every shipped text file. `*.traineddata.gz` is binary and already skipped; make sure the scan finishes quickly on multi-MB `.mjs`/`.wasm.js`.
  - Vendored files total roughly 15–25 MB, but none load until a PDF is chosen.
- **VALIDATE**:
  - `npm test` (deploy tests updated, first RED then GREEN).
  - `LOCAL_BUILD=1 … npm run build` lists the vendored files in `dist/`.
  - `npm run scan` passes.

### Task 2: `doc-reader.js` (browser only): read pages into normalized items
- **ACTION**: Load a PDF, take the text layer, and OCR textless pages.
- **IMPLEMENT**: `DocReader.read(file, { onProgress, signal }) -> Promise<{ name, pages:[{ index, source, items:[{ str, x, y, w, h, rot, conf }] }] }>`
  - **Checks first**:
    - size ≤ 25 MB
    - first bytes are `%PDF-`
    - page count ≤ 40 (else read the first 40 and say so)
  - **Load pdf.js lazily**: `const pdfjs = await import("./vendor/pdfjs-6.5.438/pdf.min.mjs"); pdfjs.GlobalWorkerOptions.workerSrc = "vendor/pdfjs-6.5.438/pdf.worker.min.mjs";` then `getDocument({ data, isEvalSupported: false, disableFontFace: true })`.
  - **Text layer**: for each page, `getTextContent()` → items with `x = t[4]`, `y = viewport.height - t[5]`, `rot = atan2(t[1], t[0])`.
  - **OCR fallback**: if a page's text has fewer than 20 non-space characters, render it to an offscreen canvas at scale 2.5 and OCR it.
  - **Tesseract**: inject `vendor/tesseract-7.0.0/tesseract.min.js` once via a `<script>` element (so CSP `'self'` covers it), then call `createWorker("eng", 1, { workerPath: "vendor/tesseract-7.0.0/worker.min.js", corePath: "vendor/tesseract-7.0.0/core/", langPath: "vendor/tesseract-7.0.0/lang/", workerBlobURL: false, gzip: true })`. Map OCR words to items (`conf` = word confidence / 100).
  - **Cancel**: `signal.aborted` → terminate the Tesseract worker, `pdf.destroy()`, then throw `DocReadError("cancelled")`.
  - **Errors**: `DocReadError` kinds are `too_large`, `not_pdf`, `encrypted` (pdf.js `PasswordException`), `unreadable`, `cancelled`.
- **MIRROR**: StoreError-style typed errors (`store.js`); no `console` output.
- **GOTCHA**:
  - Reuse one Tesseract worker across pages.
  - Release each canvas after use (`canvas.width = 0`) to keep memory down on phones.
  - pdf.js item `str` can be empty or whitespace only; skip those.
  - One `VENDOR` constant holds all vendored paths.
- **VALIDATE**: e2e (Task 9) reads a typed fixture with source "text" and a scanned fixture with source "ocr".

### Task 3: `doc-lines.js` (pure): items → lines → table rows
- **ACTION**: Rebuild reading order and table structure from positioned items.
- **IMPLEMENT**:
  - `DocLines.toLines(items)`:
    - drop items with `|rot| > 5°` from row-building (keep them as separate "label" lines)
    - sort by y, then x
    - group items whose vertical centres differ by ≤ 0.5 × median height
    - within a line, join items, inserting a cell break where the x gap is > 1.5 × median char width
    - returns `[{ text, cells:[{ text, x0, x1 }], y, label: boolean }]`
  - `DocLines.tables(lines)`:
    - find runs of ≥ 3 consecutive lines with ≥ 2 cells whose x-starts align (±8 units)
    - the first line of a run is the header if it contains no numbers
    - returns `[{ header:[…], rows:[[…]], lineIndexes:[…] }]`
- **MIRROR**: Pure, no DOM; the UMD shape.
- **GOTCHA**: OCR text is noisy (`m2`/`m²`/`rn2`, `°C`/`oC`, `O`↔`0` inside numbers). Normalize in `intake-match`, not here, so line geometry stays faithful.
- **VALIDATE**: `tests/doc-lines.test.js` covers:
  - a 3-column table fixture → expected header and rows
  - a two-column page doesn't merge columns
  - rotated drawing labels stay separate
  - empty input → `[]`

### Task 4: Move `optionsFor` into `project-state.js`
- **ACTION**: Make select options available to Node tests and the matcher.
- **IMPLEMENT**:
  - Move `OPTION_OVERRIDES` and `optionsFor(param)` from `app.js:15-19, 465-470` into `project-state.js` and export them.
  - In app.js, keep `const optionsFor = ProjectState.optionsFor;` and `const OPTION_OVERRIDES = ProjectState.OPTION_OVERRIDES;`.
  - Add a unit test that HVAC-001 gives the five grade options, and that a `unit_options` string splits on " / ".
- **GOTCHA**: Every use of `OPTION_OVERRIDES` and `optionsFor(` in app.js must keep working (grep both first).
- **VALIDATE**: `npm test` stays green, and the e2e Step 3 still renders selects.

### Task 5: `intake-vocab.js` (pure): synonyms and units
- **ACTION**: One place for every word that maps document text to the dataset.
- **IMPLEMENT** (all targets are dataset ids/options; matching is case- and punctuation-insensitive, on whole tokens):
  - **`categories`**: e.g. `sterile: ["sterile", "parenteral", "injectable", "aseptic"]`, `osd_production: ["oral solid", "osd", "tablet", "capsule"]`, `ext_prep: ["topical", "external preparation", "ointment", "cream"]`, `osd_rnd_pilot: ["pilot plant", "r&d", "formulation development"]`.
  - **`forms`**: every `SPECIFIC_FORMS` entry plus short forms ("PFS" → "Sterile Liquid (PFS)", "vial" → "Sterile Liquid (Vial)", "MR tablet" → "Tablet (Modified Release)", …).
  - **`markets`**: `schedule_m: ["schedule m", "cdsco"]`, `us_fda: ["usfda", "us fda", "fda", "21 cfr"]`, `eu_gmp: ["eu gmp", "eu-gmp", "annex 1", "ema"]`, `pics: ["pic/s", "pics"]`, `who_gmp: ["who gmp", "who trs"]`, `uk_mhra: ["mhra"]`, `china_nmpa: ["nmpa"]`, `japan_pmda: ["pmda"]`, `tga_australia: ["tga"]`, `sahpra: ["sahpra"]`, `sfda: ["sfda"]`. Only authorities with `covered !== false` produce candidates; uncovered ones produce a "not covered by this dataset" note in review.
  - **`roomSynonyms(DATA)`**: auto-built from each room `name` (the full name, each "/"-part, the part before "(", lowercased) plus a hand-added `ROOM_EXTRAS` map ("filling" → Z-29, etc.).
  - **`headers`** (column header → paramId): "area", "net area", "area (m2)", "sq m", "sq ft" → DIM-001; "length" → DIM-002; "width" → DIM-003; "height", "clear height" → DIM-004; "grade", "class", "iso class", "cleanliness" → HVAC-001; "temp", "temperature" → HVAC-002; "rh", "humidity" → HVAC-003; "ach", "air changes" → HVAC-004; "dp", "Δp", "pressure", "differential pressure" → HVAC-005; and so on for the remaining number, number-range, select and boolean parameters in `data/parameters.json`.
  - **`units`**: m² (`m2 m² sqm sq m sq.m rn2`), ft² → m² ×0.092903; °C (`°c oc deg c`), °F → °C; Pa (`pa pascal`), mmWC → Pa ×9.80665, inWC → Pa ×249.089; %RH; ACH (`ach /hr air changes`).
  - **`grades`**: "grade a", "iso 5", "iso class 5", "class 100" → "Grade A (ISO 5)"; "grade b" → "Grade B"; "grade c", "iso 7", "class 10,000" → "Grade C (ISO 7)"; "grade d", "iso 8", "class 100,000" → "Grade D (ISO 8)"; "cnc", "unclassified", "controlled not classified" → "Unclassified/CNC". Targets must equal `ProjectState.optionsFor(HVAC-001)` exactly.
- **GOTCHA**:
  - Do NOT put this in `data/`: adding a data file changes the manifest content hash and marks every saved project stale.
  - Short synonyms ("who", "pa", "c") match only as whole tokens next to numbers or headers, never as substrings.
- **VALIDATE**: An integrity test checks every vocab target exists in DATA or ProjectState (no typos): every grade maps to an `optionsFor(HVAC-001)` option, every market key is in `authorities.json`, every header paramId is in `parameters.json`, every room extra id is in `rooms.json`.

### Task 6: `intake-match.js` (pure): rule extractor, conflicts, buildInputs
- **ACTION**: Turn lines into candidates, resolve duplicates, and build validated inputs.
- **IMPLEMENT**:
  - **`IntakeMatch.ruleExtractor.run(doc, { DATA, vocab })`**:
    1. **Facility-level keywords anywhere**: category (highest synonym score), forms, dev stage, markets. Confidence is high for unambiguous phrases ("EU GMP", "Sterile Liquid (Vial)"), medium for single generic words ("fda", "sterile").
    2. **Tables**: for each `DocLines.tables` table, map header cells to paramIds via `vocab.headers` and find the room column (cells matching `roomSynonyms` with token Dice ≥ 0.75). Each row gives `room` + `param` candidates; parse each cell with that param's kind. Confidence is high when both the header and the room matched strongly and the value parsed cleanly; medium on a fuzzy room (0.6–0.75) or OCR conf < 0.8; low otherwise.
    3. **Free lines** (not in a table): a line containing a room synonym plus a "number + unit" or grade phrase gives candidates for the param implied by the unit (m² → DIM-001, °C → HVAC-002, %RH → HVAC-003, Pa → HVAC-005, ACH → HVAC-004, grade phrase → HVAC-001). Confidence is medium; on drawing label lines (`label: true` or short isolated lines) it is low.
    4. **Rooms**: a matched room produces a `{kind:"room", roomId}` candidate, so it gets ticked in Step 2. Rooms not in the chosen/derived category's `applies_to` are low confidence, with reason "room not used for <category>".
  - **Value parsers**, one per kind, sharing `resolveInputKind`:
    - number: handles "1,200", "1 200", "120.5"
    - number-range: "20–25", "20-25", "20 to 25", "22 ± 2" → {20, 24}, "≤ 25" → {min:null, max:25}, "NMT 60" → max 60, "NLT 15" → min 15
    - select: via vocab (grades), or exact or fuzzy match to `optionsFor`
    - boolean: yes/no/required/provided
    - text: never auto-filled from free lines
    - Reject NaN and |v| > 1e9; everything must pass `ProjectState.validateInputs` later.
  - **`resolve(candidates, state)`**: groups by target key. If values agree, keep one (best confidence, all sources listed). If they disagree, mark `conflict: true` with options and no default tick. If the current state already has a different value, mark `replaces: <current display>` and set the default tick off unless confidence is high. Each resolved item gets `checked` (default: high, no conflict).
  - **`buildInputs(state, accepted, DATA)`**:
    - starts from `ProjectState.serializeInputs(state)`
    - applies accepted candidates (category first; switching category clears incompatible forms and rooms the same way `ProjectState.switchCategory` does)
    - adds markets, keeping `primaryAuthority` if still valid, else the first covered target market, which is flagged in the summary
    - adds selected rooms and the values
    - returns `ProjectState.validateInputs(next, DATA)`. On `ok:false` the review shows the errors and nothing changes.
  - **`extractors = [ruleExtractor]`** plus `runAll(doc, ctx)`, which concatenates their results. This is the AI slot.
- **MIRROR**: `hasOwn` lookups; `FORBIDDEN_KEYS`; pure functions with no DOM.
- **GOTCHA**:
  - "20-25" must not become a negative number.
  - "Room 12" or "Rev. 3" numbers must not be read as areas: require a unit or a header.
  - Grade "B" alone is too ambiguous unless it is in a grade column.
  - Normalize OCR digits (`O`→`0`, `l`/`I`→`1`) only inside numeric tokens.
- **VALIDATE**: `tests/intake-match.test.js`, using fixtures (see Testing Strategy).

### Task 7: `intake-view.js` (pure): panel, progress, review, summary
- **ACTION**: Render the upload panel, the progress state and the review list from data.
- **IMPLEMENT**:
  - **`uploadPanel(h, { onFile })`**:
    - a `<label for>` file input with `accept="application/pdf"`
    - a privacy note: "Read on this computer — the file is never uploaded."
    - a supported-types and limits line
  - **`progress(h, { name, page, pages, source, onCancel })`**: a `<progress>` element with a text equivalent, an sr-only `role=status` line ("Reading page 3 of 8 (scanned)"), and a Cancel button.
  - **`review(h, { items, labels, onApply, onDiscard })`**:
    - groups: Facility, then one group per room (room name as an `<h4>`), each candidate as a row
    - each row has a checkbox labelled by its field name and value, the current value, a source snippet "p.N: …" (text), a confidence word plus glyph (never colour alone), the reason, and any conversion note
    - conflicts are a radio group with a "Don't fill" option
    - an "Not matched" `<details>` lists unplaced lines (first 50)
    - "Select all high-confidence" and "Clear all" buttons
    - the apply button text includes the count and updates live
  - **`summary(h, { filled, skipped, errors, onGo })`** after apply: focusable heading, list of what changed, buttons to Steps 1/2/3.
- **MIRROR**: The `results-view.js` style: `h`/`setKids`, `nextId` ids, `srOnly`, the `rankedList` pattern for live counts.
- **GOTCHA**:
  - Snippets are truncated to 200 chars and shown as text.
  - Long room lists need the jump-list pattern from Step 3 (`app.js:571-580`).
- **VALIDATE**: `tests/intake-view.test.js`:
  - every checkbox has a label
  - conflicts render as radios with no default
  - the confidence word is present
  - no `title` attributes
  - markup-looking snippets stay text
  - ids are unique across two renders

### Task 8: Wire into `app.js`, `index.html` and `styles.css`
- **ACTION**: Connect reading → review → apply.
- **IMPLEMENT**:
  - **`renderStep1`**: insert `IntakeView.uploadPanel` above the category group. On file: build an `AbortController`, show progress, call `DocReader.read`, then `doc.pages.map(p => ({ ...p, lines: DocLines.toLines(p.items) }))`, `IntakeMatch.runAll`, `resolve`, and show the review in the same panel (replacing the upload UI).
  - **Apply**: `IntakeMatch.buildInputs(state, accepted, DATA)`. If ok: `ProjectState.resetState(state, r.inputs)`; set `intakeNotes` (a session Map of `"room|param"` → `"From <file> p.N"`); `announce("N values filled from <file>")`; show the summary. The existing fingerprint logic marks the project unsaved.
  - **`renderParamField`**: if an `intakeNotes` entry exists for this field and the value is unchanged, add a `field-note` "From <file> p.N". Clear it on edit.
  - **Errors** map to messages:
    - too_large → "This file is over 25 MB."
    - not_pdf → "This isn't a PDF."
    - encrypted → "This PDF is password-protected; save an unprotected copy."
    - unreadable → "This PDF couldn't be read."
    - cancelled → no message
  - **`index.html`**: add the five new scripts after `project-state.js` and before `app.js`.
  - **CSS**: `.intake-*` classes, matching the panel styles.
- **GOTCHA**:
  - Filling over existing values happens only for rows the planner left ticked. The review's "replaces" markers cover this.
  - Keep the main thread responsive: OCR runs in the worker, while pdf.js rendering is main-thread. Yield between pages with `await new Promise((r) => setTimeout(r))`.
- **VALIDATE**: The manual flow in Chromium at 390 and 1440 px; no console or CSP errors.

### Task 9: E2E: real PDFs through the browser under the production CSP
- **ACTION**: Prove reading, OCR, review and apply work in Chromium with the real headers.
- **IMPLEMENT**: `e2e/intake.e2e.js`, using `launch`, `signIn` and `uniqueEmail` from `e2e/lib.js`.
  - **Fixtures**: generate them in the test with Playwright, so there are no binary files to maintain.
    - Typed: `page.setContent(<html table of 3 rooms: name | Area (m²) | Grade | Temp (°C) | RH (%) | ΔP (Pa)>)`, then `page.pdf()`.
    - Scanned: screenshot that table, `setContent(<img src="data:image/png;base64,…">)`, then `page.pdf()`. This gives an image-only PDF.
  - **Checks**:
    - after `setInputFiles`, the review lists the 3 rooms with their areas and grades, with source "p.1" (typed)
    - the scanned PDF goes through OCR (the progress says "scanned") and still finds ≥ 2 of 3 areas
    - Apply fills `state.roomValues` and `state.selectedRooms` with exactly the ticked values
    - Cancel during OCR leaves state unchanged
    - a text file named `.pdf` shows "This isn't a PDF."
    - axe passes on the review screen at 390 and 1440 px
    - no console errors (incl. CSP)
  - Add the file to the `test:e2e` script.
- **GOTCHA**:
  - OCR in CI is slow (~5–20 s per page). Keep the scanned fixture to 1 page and raise the per-step timeout.
  - The e2e serve uses the vercel.json headers, so the CSP change is exercised.
- **VALIDATE**: `npm run test:e2e` is all PASS.

### Task 10: Document the AI slot (no code beyond the contract)
- **ACTION**: Write down how AI joins later, so it isn't redesigned.
- **IMPLEMENT**: Add to `README.md` and a short `.claude/plans/ai-intake-later.md`:
  - an `aiExtractor` implementing the contract
  - run server-side (Supabase Edge Function or Vercel Function) with the user's explicit per-document consent
  - receives the extracted text, not the PDF, and returns candidates with `reason: "AI"`
  - always medium confidence until expert-validated
  - the same review and `validateInputs`
  - "Summarise this document" and results summaries are separate later features using the same consent model
  - the CSP `connect-src` gains only that function's origin
  - Model choice is decided when built (default to the latest Claude model then).
- **VALIDATE**: The docs exist; no AI code or keys in the repo (`npm run scan`).

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| lines from table items | fixture `typed-table.json` (3 cols × 4 rows) | 4 lines, 3 cells each, header detected | |
| two-column page | fixture with two text columns | columns not merged into one line | yes |
| rotated labels | drawing fixture with rot 90° items | kept as separate label lines | yes |
| header → param map | "Area (m²)", "Temp. (°C)", "ΔP (Pa)" | DIM-001, HVAC-002, HVAC-005 | |
| room fuzzy match | "Aseptic filling room" | Z-29, high | |
| room weak match | "Filling area 2" | Z-29, medium | yes |
| grade synonyms | "ISO 7", "Class 10,000", "Grade C" | "Grade C (ISO 7)" | |
| range parse | "22 ± 2 °C", "20–25", "NMT 60 %RH" | {20,24}, {20,25}, {null,60} | yes |
| unit conversion | "1,292 sq ft" | 120.03 m², `converted` set | yes |
| OCR digit noise | "12O m2" | 120 m² | yes |
| no unit, no header | "Room 12 Rev 3" | no candidate | yes |
| conflict | same room+param, 18 °C and 19–24 °C | `conflict:true`, no default tick | yes |
| replaces | state has 100 m², doc says 120 m² | `replaces:"100 m²"`, ticked only if high | yes |
| uncovered market | "UK MHRA" | note "not covered", no market candidate | yes |
| buildInputs valid | accepted set | `validateInputs.ok === true`, values present | |
| buildInputs category switch | accept "Sterile" over existing "osd_production" | incompatible forms/rooms dropped, as in `switchCategory` | yes |
| buildInputs rejects junk | candidate with value NaN or a forbidden key | `ok:false`, state untouched | yes |
| vocab integrity | all vocab targets | exist in DATA / optionsFor | |
| optionsFor moved | HVAC-001, a " / " param | 5 grade options; split list | |
| view a11y | review render | labels, radios, words, no title attrs, text-only snippets, unique ids | |
| deploy CSP | vercel.json + build | `script-src 'self' 'wasm-unsafe-eval'`, `worker-src 'self'`; vendored files in dist | |

### Edge Cases Checklist
- [ ] Empty PDF / no text and OCR finds nothing → review says "Nothing we could match", with Not matched lines
- [ ] 25 MB+ file, 40+ pages
- [ ] Password-protected PDF
- [ ] Not a PDF (renamed file)
- [ ] Cancel mid-OCR
- [ ] Very long room names / 57 rooms in one document
- [ ] Mixed document: typed pages plus scanned appendix
- [ ] Drawing PDF: rotated labels, room tags with area text
- [ ] Re-running intake on an already filled project (replaces)
- [ ] Phone width (390 px): review usable, no horizontal page scroll

---

## Validation Commands

### Static Analysis
No type checker or linter in this project (vanilla JS, no build step).
```bash
for f in doc-lines.js intake-vocab.js intake-match.js intake-view.js doc-reader.js; do node --check "$f"; done
```
EXPECT: No syntax errors

### Unit Tests
```bash
node --test tests/doc-lines.test.js tests/intake-match.test.js tests/intake-view.test.js tests/deploy.test.js tests/project-state.test.js
```
EXPECT: All pass

### Full Test Suite
```bash
npm test && npm run scan && npm run audit:high
```
EXPECT: No regressions (282+ pass), 0 secret findings, 0 high vulnerabilities

### Database Validation
```bash
npm run test:db
```
EXPECT: 23/23 (no schema change in this plan)

### Browser Validation
```bash
npx supabase start
LOCAL_BUILD=1 SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=$(npx supabase status -o env | sed -n 's/^ANON_KEY="\(.*\)"$/\1/p') npm run build
npm run serve:dist   # in another shell
npm run test:e2e
```
EXPECT: All PASS, including `intake.e2e.js`, axe on the review screen, and no CSP console errors

### Manual Validation
- [ ] Upload a real typed room-data sheet from the domain expert: rooms and areas proposed with correct page numbers
- [ ] Upload a phone photo of a printed sheet (printed to PDF): OCR runs, values proposed with medium/low confidence where noisy
- [ ] Upload a layout drawing: room names found, areas only where labelled
- [ ] Untick two values, apply: exactly the ticked values filled; Step 3 shows "From … p.N"
- [ ] Keyboard-only and VoiceOver pass through upload → progress → review → apply

---

## Acceptance Criteria
- [ ] A typed table PDF fills the rooms and their area, grade, temperature, RH and pressure after review, with no manual typing
- [ ] A scanned (image-only) PDF is OCR'd in the browser and proposes values with confidence labels
- [ ] Nothing changes in the project until "Fill the selected values"; Cancel and Discard change nothing
- [ ] Every filled value passed `ProjectState.validateInputs`
- [ ] The file never leaves the browser (no network request carries it; CSP `connect-src` unchanged)
- [ ] The CSP adds only `'wasm-unsafe-eval'` (and explicit `worker-src 'self'`)
- [ ] All validation commands pass; unit and e2e tests written as listed
- [ ] The extractor contract is documented and the AI slot is described, with no AI code or keys

## Completion Checklist
- [ ] Code follows the UMD/pure-module patterns
- [ ] Errors are typed (`DocReadError`) and shown as plain-language text
- [ ] No `console.*` with document content
- [ ] Tests follow the `node:test` patterns; fixtures are JSON items, PDFs generated in e2e
- [ ] No hardcoded paths outside one `VENDOR` constant in `doc-reader.js`
- [ ] README updated (feature, privacy, supported documents, limits)
- [ ] No scope additions beyond "NOT Building"

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Drawings rarely give clean values (labels scattered, rotated, area tags far from names) | High | Medium | Drawings are best-effort: names plus nearby labelled values at low confidence; set expectations in the UI copy; AI extractor later |
| OCR accuracy on poor scans or photos (skew, low DPI) | Medium | Medium | 2.5× render; confidence from word conf; low-confidence values unticked by default; review always shown |
| Client documents use vocabulary the synonyms don't know | High | Medium | `intake-vocab.js` is one editable file; the "Not matched" list shows what was missed; ask the domain expert for 3–5 real samples before tuning |
| Bundle size (~15–25 MB vendored) | Medium | Low | Lazy-load only on file choice; nothing loads on page open; Vercel serves the static files with caching |
| CSP loosening (`wasm-unsafe-eval`) | Low | Low | Allows WASM compile only; no `unsafe-eval` or `unsafe-inline`; deploy test pins the exact policy |
| Large PDFs freeze phones | Medium | Medium | Page cap 40, size cap 25 MB, per-page yield, canvas released after each page, Cancel |
| Library CVEs (pdf.js has had font-handling CVEs) | Low | Medium | `isEvalSupported: false`, `disableFontFace: true`, pinned recent version, Dependabot (security review item #6) |

## Notes
- The **matching**, not OCR, decides quality. Get real sample PDFs from the domain expert (typed RDS/URS, a scan, a drawing) before Task 6 tuning. They can become anonymized fixtures.
- **Privacy**: the in-browser design means no facility document is ever sent anywhere, which can be stated to clients. This plan does not touch the database.
- **Out-of-scope follow-ups**: more OCR languages; Excel/Word intake; AI extractor and summaries (Task 10 slot).
- Security review items #1 (CAPTCHA) and #3 (hosted auth settings) are independent of this plan.
