// Runs every expert reference case in expert-review/reference-cases/*.json (files
// starting with "_" are templates and ignored). Skipped until a case exists.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { engine, loadData, makeState } = require("./helpers.js");

const CASE_DIR = path.join(__dirname, "..", "expert-review", "reference-cases");
const DATA = loadData();

function caseFiles() {
  return fs.readdirSync(CASE_DIR).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
}

function findResult(rows, booleanRows, exp) {
  if (exp.benchmark.startsWith("THR-B")) {
    const row = booleanRows.find((r) => r.threshold.id === exp.benchmark && (r.room ? r.room.id : null) === exp.room);
    return row ? { status: row.status, provenance: row.provenance } : null;
  }
  const row = rows.find((r) => r.threshold.id === exp.benchmark && (r.room ? r.room.id : null) === exp.room);
  return row ? row.evalResult.perMarket[exp.authority] || null : null;
}

function runCase(file) {
  const c = JSON.parse(fs.readFileSync(path.join(CASE_DIR, file), "utf8"));
  const state = makeState(c.facility);
  const rows = engine.buildEvaluationRows(DATA, state);
  const booleanRows = engine.buildBooleanRows(DATA, state);

  for (const exp of c.expected) {
    const where = `${file}: ${exp.benchmark} / room ${exp.room} / ${exp.authority || "checklist"}`;
    const r = findResult(rows, booleanRows, exp);
    assert.ok(r, `${where} — engine produced no result`);
    assert.equal(r.status, exp.status, `${where} — status`);
    if (exp.obligation) assert.equal(r.provenance && r.provenance.obligation, exp.obligation, `${where} — obligation`);
    if (exp.fallback_status) assert.equal(r.fallback && r.fallback.status, exp.fallback_status, `${where} — fallback`);
  }

  if (c.expected_rollup) {
    const booleanAsRows = booleanRows.map((br) => ({
      threshold: br.threshold, param: br.param,
      evalResult: { perMarket: Object.fromEntries(state.targetMarkets.map((mk) => [mk, { status: br.status }])) },
    }));
    const rollup = engine.computeMarketRollup(DATA, state, rows.concat(booleanAsRows));
    for (const [mk, verdict] of Object.entries(c.expected_rollup)) assert.equal(rollup[mk], verdict, `${file}: rollup ${mk}`);
  }
}

const files = caseFiles();
if (!files.length) {
  test("expert reference cases", { skip: "no expert cases yet — add expert-review/reference-cases/*.json (see expert-review/README.md)" }, () => {});
} else {
  for (const f of files) test(`expert reference case: ${f}`, () => runCase(f));
}

// Guard the template itself so it stays a valid, copyable example.
test("reference-case template is valid against the current engine", () => runCase("_template.json"));
