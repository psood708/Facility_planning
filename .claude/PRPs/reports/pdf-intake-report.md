# Implementation Report: Fill the facility from a PDF

## Summary
The planner picks a PDF in Step 1, and it is read in the browser:
- pdf.js reads the text layer.
- Tesseract OCR reads pages that have no text.

Nothing is uploaded or stored. Rule-based matching against the dataset's own vocabulary proposes values for:
- category, forms and markets
- rooms, and room and facility parameters

A review screen shows each value with its page and line, a confidence label and what it would replace. Only ticked values are applied, through `ProjectState.validateInputs`. An extractor contract leaves a slot for an opt-in AI extractor later.

## Assessment vs Reality
| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Large | Large |
| Confidence | 7/10 | Built in one pass, plus fixes found against a real 53-page PDF and in review |
| Files Changed | 9 new, 9 updated | 13 new (+ vendored folders), 13 updated |

## Tasks Completed
| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Vendor pdf.js + Tesseract; CSP for WASM | done | Only the 3 LSTM cores are vendored (~17 MB total, lazy-loaded) |
| 2 | `doc-reader.js` | done | Deviated: baseline y (not top) so mixed font sizes in a row align; OCR scale capped at 16 MP; a failed OCR page is skipped, not fatal; 200 text pages / 40 OCR pages |
| 3 | `doc-lines.js` | done | Added multi-line header merge and item-level column placement (Word/HTML tables with wrapped headers and vertically centred cells) |
| 4 | `optionsFor` moved to project-state | done | |
| 5 | `intake-vocab.js` | done | |
| 6 | `intake-match.js` | done | Added long tables (ROOM / PARAMETER / VALUE), "Param (Room): value" lines and value-on-next-line, recommendation sentences, room-name stripping (grades inside names), lakh numbers, OCR-only digit fixes, `applied`/`skipped` reporting and memory copy |
| 7 | `intake-view.js` | done | No RED run recorded before implementation (tests written first, run after) |
| 8 | app.js wiring | done | Review fixes: reset on new/open/restart/sign-out; reads guarded by controller; in-place progress updates |
| 9 | e2e | done | 18 checks: typed and scanned PDFs, apply, reset, cancel, not-a-PDF, axe at 390/1440, no CSP errors |
| 10 | AI slot docs | done | `.claude/plans/ai-intake-later.md`, README |

## Validation Results
| Level | Status | Notes |
|---|---|---|
| Static Analysis | Pass | No type checker in this project; `node --check` passes |
| Unit Tests | Pass | 326 pass, 1 skipped (expert cases) |
| Build | Pass | Vendored folders shipped; build secret scan clean |
| Database | Pass | 23 |
| Integration (e2e) | Pass | 152 checks, including `intake.e2e.js` |
| Real document | Pass | The user's 53-page report (local only, not committed): 357 values offered for review, 342 high-confidence, 0 conflicts. Applying gives category sterile and 26 rooms, with no errors |

## Deviations from Plan
- **No "Not matched lines" list** on the review screen, for simplicity.
- **Fixtures are built in code** rather than stored as JSON files. The real sample PDF is a local check only, because the repo is public.
- **Page caps** split into 200 text pages and 40 OCR pages, after the 40-page cap cut the real 53-page report short.
- **`scripts/serve.js`** gained `.mjs`, `.wasm` and `.gz` MIME types. Browsers refuse module scripts served as octet-stream; Vercel serves `.mjs` correctly.
- **pdf.js 6** cleans up through `loadingTask.destroy()`; the document has no `destroy()`.

## Issues Encountered
- A printed Word/HTML table split its rows across several lines. Fixed with the header-block merge and gap banding.
- Top-edge y split rows whose columns use different font sizes. Fixed by using baselines.
- Grades inside room names ("Grade D→Grade C") and form words in room names were read as values. Fixed by stripping room names and their fragments.
- The sticky Fill bar was hidden under the sticky wizard footer. It is now offset above it.
- The review found that intake state leaked across projects (HIGH), plus dropped values counted as filled, a canvas size limit, progress focus loss and missing room context. All fixed, with tests.

## Tests Written
| Test File | Tests | Coverage |
|---|---|---|
| `tests/doc-lines.test.js` | 10 | lines, cells, labels, long/wide/wrapped-header tables, OCR confidence |
| `tests/intake-match.test.js` | 24 | vocabulary integrity, every source of values, parsing, resolve, buildInputs, prototype safety, contract |
| `tests/intake-view.test.js` | 12 | labels, groups, conflicts, ticks and counts, notes, progress in place, summary |
| `tests/deploy.test.js`, `tests/project-state.test.js`, `tests/dom-safety.test.js` | updated | CSP, shipped files, optionsFor, HTML-sink scan of the new scripts |
| `e2e/intake.e2e.js` | 18 checks | the real browser under the production CSP |

## Not done (from review, noted)
- **Review list goes stale** if Step 1 is changed while it is open. Only the display is affected; apply uses the current state.
- **Matching performance on 200-page documents** (one-off stall). Fine at 53 pages.
- **No checksum assertion for vendored files** (hashes are printed by `scripts/vendor-ocr.js`).
- **Header merge edge case** (a digit-free wrapped row right above a header).
