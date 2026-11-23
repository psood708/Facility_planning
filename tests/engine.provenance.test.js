// New behaviour (PRD milestone 1): every result carries its source and a
// mandatory/recommended label; missing or conflicting authority values are
// labelled as an international/industry-standard fallback — never presented
// as an authority requirement.
const test = require("node:test");
const assert = require("node:assert/strict");
const { engine, loadData, makeState, thresholdById } = require("./helpers.js");

const DATA = loadData();
const COVERED = ["schedule_m", "us_fda", "eu_gmp", "who_gmp", "china_nmpa", "japan_pmda"];
const OBLIGATIONS = ["mandatory", "recommended", "unclassified"];
const PENDING = "Citation pending expert review";

test("provenance data file is loaded", () => {
  assert.ok(DATA.provenance && DATA.provenance.entries, "data/provenance.json present");
});

test("authority result carries a pending citation and the draft obligation label", () => {
  const thr = thresholdById(DATA, "THR-001");
  const r = engine.evaluateNumericOrCategorical(DATA, thr, { min: 19, max: 21 }, ["eu_gmp"]);
  const p = r.perMarket.eu_gmp.provenance;
  assert.equal(p.citation, null);
  assert.equal(p.citationLabel, PENDING);
  assert.equal(p.obligation, "recommended");
  assert.equal(p.obligationStatus, "draft");
});

test("not-covered authorities get no provenance (nothing to cite)", () => {
  const thr = thresholdById(DATA, "THR-001");
  const r = engine.evaluateNumericOrCategorical(DATA, thr, { min: 19, max: 21 }, ["uk_mhra"]);
  assert.equal(r.perMarket.uk_mhra.provenance, undefined);
  assert.equal(r.perMarket.uk_mhra.fallback, undefined);
});

test("room area result cites the workbook's Schedule M source as mandatory (draft)", () => {
  const state = makeState({ selectedRooms: ["Z-29"], roomValues: { "Z-29": { "DIM-001": 120 } } });
  const area = engine.buildEvaluationRows(DATA, state).find((r) => r.areaOverride);
  const p = area.evalResult.perMarket.schedule_m.provenance;
  assert.match(p.citation, /150 m²/);
  assert.equal(p.citationLabel, p.citation);
  assert.equal(p.obligation, "mandatory");
});

test("cleanroom grade result cites the Room-Zone Master List", () => {
  const state = makeState({ selectedRooms: ["Z-29"], roomValues: { "Z-29": { "HVAC-001": "Grade B" } } });
  const grade = engine.buildEvaluationRows(DATA, state).find((r) => r.gradeOverride);
  const p = grade.evalResult.perMarket.schedule_m.provenance;
  assert.match(p.citationLabel, /Room-Zone Master List/);
  assert.ok(OBLIGATIONS.includes(p.obligation));
});

test("every scored result in a full facility shows a source and an obligation label", () => {
  const rooms = DATA.rooms.filter((r) => r.applies_to.sterile).map((r) => r.id);
  const state = makeState({ targetMarkets: COVERED, selectedRooms: rooms });
  const rows = engine.buildEvaluationRows(DATA, state);
  assert.ok(rows.length > 50, "scenario covers many rows");
  for (const row of rows) {
    for (const mk of COVERED) {
      const r = row.evalResult.perMarket[mk];
      if (!["compliant", "non_compliant", "no_value"].includes(r.status)) continue;
      assert.ok(r.provenance, `${row.threshold.id}/${mk} has provenance`);
      assert.ok(r.provenance.citationLabel, `${row.threshold.id}/${mk} has a source label`);
      assert.ok(OBLIGATIONS.includes(r.provenance.obligation), `${row.threshold.id}/${mk} obligation`);
    }
  }
});

test("missing authority value: verdict stays 'not_regulated', fallback evaluated and labelled", () => {
  const thr = thresholdById(DATA, "THR-001"); // Schedule M gives no number; industry 18–22 (ISPE)
  const warm = engine.evaluateNumericOrCategorical(DATA, thr, { min: 19, max: 24 }, ["schedule_m"]);
  const r = warm.perMarket.schedule_m;
  assert.equal(r.status, "not_regulated");
  assert.equal(r.fallback.status, "non_compliant");
  assert.equal(r.fallback.min, 18);
  assert.equal(r.fallback.max, 22);
  assert.equal(r.fallback.label, "International/industry standard (fallback)");
  assert.equal(r.fallback.obligation, "recommended");
  assert.match(r.fallback.note, /ISPE/);

  const ok = engine.evaluateNumericOrCategorical(DATA, thr, { min: 19, max: 21 }, ["schedule_m"]);
  assert.equal(ok.perMarket.schedule_m.fallback.status, "compliant");

  const blank = engine.evaluateNumericOrCategorical(DATA, thr, "", ["schedule_m"]);
  assert.equal(blank.perMarket.schedule_m.fallback.status, "no_value");
});

test("fallback failures never change an authority's overall verdict", () => {
  // THR-018 compressed air: Schedule M gives no class; industry requires Class 1.2.1; severity Critical
  const state = makeState({ targetMarkets: ["schedule_m"], facilityValues: { "UTIL-001": "Class 2" } });
  const rows = engine.buildEvaluationRows(DATA, state);
  const air = rows.find((r) => r.threshold.id === "THR-018");
  assert.equal(air.evalResult.perMarket.schedule_m.fallback.status, "non_compliant");
  const rollup = engine.computeMarketRollup(DATA, state, rows);
  assert.notEqual(rollup.schedule_m, "Non-Compliant");
});

test("conflicting authorities (no value satisfies both) are flagged with the fallback as reference", () => {
  const thr = {
    id: "THR-TEST-CONFLICT", type: "numeric", unit: "Pa", severity: "Critical",
    authorities: {
      eu_gmp_pics: { covered: true, specified: true, min: 10, max: 15 },
      us_fda: { covered: true, specified: true, min: 20, max: 30 },
      industry: { covered: true, specified: true, min: 12, max: 25, note: "test reference" },
    },
  };
  const r = engine.evaluateNumericOrCategorical(DATA, thr, 18, ["eu_gmp", "us_fda"]);
  assert.deepEqual(r.conflict.markets.sort(), ["eu_gmp", "us_fda"]);
  assert.equal(r.conflict.reference.min, 12);
  assert.equal(r.conflict.reference.max, 25);
  assert.equal(r.conflict.reference.label, "International/industry standard (fallback)");
});

test("overlapping authority ranges are not a conflict", () => {
  const thr = thresholdById(DATA, "THR-001"); // EU 18–22 and PMDA 18–26 overlap
  const r = engine.evaluateNumericOrCategorical(DATA, thr, { min: 19, max: 21 }, ["eu_gmp", "japan_pmda"]);
  assert.equal(r.conflict, null);
});

test("authority recommendations carry obligation, basis and citations", () => {
  const state = makeState({ selectedRooms: ["Z-29"], roomValues: { "Z-29": { "DIM-001": 120 } } });
  const rows = engine.buildEvaluationRows(DATA, state);
  const rec = engine.buildRecommendations(DATA, state, rows).find((x) => x.id === "AREA-Z-29-Z-29");
  assert.equal(rec.basis, "authority");
  assert.equal(rec.obligation, "mandatory");
  assert.equal(rec.obligationStatus, "draft");
  assert.ok(rec.citations.some((c) => /150 m²/.test(c)));
});

test("fallback gaps produce a separate, clearly labelled recommendation after authority gaps", () => {
  const state = makeState({
    targetMarkets: ["schedule_m"],
    selectedRooms: ["Z-29"],
    roomValues: { "Z-29": { "HVAC-002": { min: 19, max: 24 }, "DIM-001": 120 } },
  });
  const rows = engine.buildEvaluationRows(DATA, state);
  const recs = engine.buildRecommendations(DATA, state, rows);
  const fb = recs.find((x) => x.id === "THR-001-Z-29");
  assert.ok(fb, "fallback recommendation present");
  assert.equal(fb.basis, "fallback");
  assert.equal(fb.obligation, "recommended");
  assert.match(fb.text, /international\/industry standard/i);
  assert.match(fb.text, /not specified by India — Schedule M/);
  const firstFallback = recs.findIndex((x) => x.basis === "fallback");
  const lastAuthority = recs.map((x) => x.basis).lastIndexOf("authority");
  assert.ok(lastAuthority < firstFallback, "authority gaps listed before fallback suggestions");
});

test("boolean checklist rows carry provenance", () => {
  const state = makeState({ category: "osd_production", selectedRooms: ["Z-24"], roomValues: { "Z-24": { "DFS-001": false } } });
  const dust = engine.buildBooleanRows(DATA, state).find((r) => r.threshold.id === "THR-B01");
  assert.equal(dust.provenance.obligation, "mandatory"); // schedule_m_explicit in the workbook
  assert.equal(dust.provenance.obligationStatus, "draft");
  assert.equal(dust.provenance.citationLabel, PENDING);
});
