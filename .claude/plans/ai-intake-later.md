# AI in the PDF intake and results (later — not built)

The PDF intake (2026-11-26) is built with in-browser reading and rule-based matching. The user asked for AI later, for smarter extraction and for summaries ("summarization and quick grasping"). This note fixes how it plugs in, so it isn't redesigned when it's built.

## The slot that already exists
`intake-match.js` runs every extractor in `extractors` (today only `rules`). Each extractor has the shape `{ id, label, run(doc, { DATA }) -> Candidate[] }`, where:
- **Inputs:** `doc.pages[].lines` is the document text with positions.
- **Output:** a `Candidate` is `{ target, value, display, source: { page, text }, confidence, reason, converted }`.

Candidates from every extractor go through the same `resolve()` (merge or conflict), the same review screen, and `buildInputs()`, which applies them via `ProjectState.validateInputs`. An extractor never writes project state.

## AI extractor (smarter extraction)
- **Consent:** opt-in, per document. A checkbox on the review screen says "Also ask the AI assistant to find values (sends the document's text to <provider>)". It is off by default, and nothing is sent without it.
- **What is sent:** the extracted text with page numbers, never the PDF file. It is sent to a server-side function (Supabase Edge Function or Vercel Function) that holds the API key. The browser never sees the key.
- **The prompt** names the dataset's own vocabulary: room names, parameter names with units and options, covered authorities. It asks for JSON candidates in the contract shape, each with the page and the quoted line it came from.
- **Checking the answer:** the function validates the JSON. It drops any candidate whose quoted line isn't in the document text (no invented sources) and maps ids against the dataset.
- **Confidence:** AI candidates are always "medium" with reason "AI suggestion", until the domain expert has validated accuracy on real samples. When they agree with the rule extractor, the merge keeps the better confidence.
- **CSP:** `connect-src` gains only that function's origin.
- **Model:** decide when built; default to the latest Claude model available then.

## Summaries ("quick grasping")
These are separate features, with the same consent model and server function:
- **Document summary:** a short summary of the uploaded document, shown above the review list (scope, facility type, markets, gaps the document itself mentions).
- **Results summary:** a plain-language paragraph from the results model, e.g. "Meets WHO; 3 critical changes, mostly cleanroom grades in the filling suite". It is generated from the model's numbers (never from free text), and it is labelled as AI-written and advisory.

## Not decided
- The provider and its data-retention terms. These need to be acceptable for confidential facility designs.
- Cost per document, and whether AI is a paid-tier feature (relates to Milestone 6 billing).
