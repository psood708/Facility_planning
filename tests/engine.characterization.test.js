// Characterization tests: pin the prototype's existing pass/fail behaviour so
// the provenance/fallback change cannot silently alter compliance verdicts.
const test = require("node:test");
const assert = require("node:assert/strict");
const { engine, loadData, makeState, thresholdById } = require("./helpers.js");

const DATA = loadData();
const ALL_COVERED = ["schedule_m", "us_fda", "eu_gmp", "pics", "who_gmp", "china_nmpa", "japan_pmda"];

test("numeric range: compliant inside an authority's bounds, non-compliant outside", () => {
  const thr = thresholdById(DATA, "THR-001"); // Temperature, sterile filling — EU 18–22, PMDA 18–26
  const inside = engine.evaluateNumericOrCategorical(DATA, thr, { min: 19, max: 21 }, ["eu_gmp", "japan_pmda"]);
  assert.equal(inside.perMarket.eu_gmp.status, "compliant");
  assert.equal(inside.perMarket.japan_pmda.status, "compliant");

  const warm = engine.evaluateNumericOrCategorical(DATA, thr, { min: 19, max: 24 }, ["eu_gmp", "japan_pmda"]);
  assert.equal(warm.perMarket.eu_gmp.status, "non_compliant");
  assert.equal(warm.perMarket.japan_pmda.status, "compliant");
});

test("numeric range: a blank bound never reads as compliant", () => {
  const thr = thresholdById(DATA, "THR-001");
  const r = engine.evaluateNumericOrCategorical(DATA, thr, { min: 19, max: null }, ["eu_gmp"]);
  assert.equal(r.perMarket.eu_gmp.status, "non_compliant");
});

test("authority that gives no number is 'not_regulated' and keeps its note", () => {
  const thr = thresholdById(DATA, "THR-001");
  const r = engine.evaluateNumericOrCategorical(DATA, thr, { min: 19, max: 21 }, ["schedule_m"]);
  assert.equal(r.perMarket.schedule_m.status, "not_regulated");
  assert.match(r.perMarket.schedule_m.note, /Dependent on product/);
});

test("authority with no dataset coverage is 'not_covered'", () => {
  const thr = thresholdById(DATA, "THR-001");
  const r = engine.evaluateNumericOrCategorical(DATA, thr, { min: 19, max: 21 }, ["uk_mhra"]);
  assert.equal(r.perMarket.uk_mhra.status, "not_covered");
});

test("no entered value gives 'no_value' for authorities that specify a number", () => {
  const thr = thresholdById(DATA, "THR-001");
  const r = engine.evaluateNumericOrCategorical(DATA, thr, "", ["eu_gmp", "schedule_m"]);
  assert.equal(r.hasValue, false);
  assert.equal(r.perMarket.eu_gmp.status, "no_value");
  assert.equal(r.perMarket.schedule_m.status, "not_regulated");
});

test("categorical: compressed air class compared on the hierarchy", () => {
  const thr = thresholdById(DATA, "THR-018"); // EU requires Class 1.2.1; hierarchy Class 2 < 1.2.1 < 1
  const ok = engine.evaluateNumericOrCategorical(DATA, thr, "Class 1", ["eu_gmp"]);
  assert.equal(ok.perMarket.eu_gmp.status, "compliant");
  const bad = engine.evaluateNumericOrCategorical(DATA, thr, "Class 2", ["eu_gmp"]);
  assert.equal(bad.perMarket.eu_gmp.status, "non_compliant");
  assert.equal(bad.perMarket.eu_gmp.required, "Class 1.2.1");
});

test("room area: Schedule M minimum checked; other authorities have no figure", () => {
  const state = makeState({
    targetMarkets: ["schedule_m", "us_fda"],
    selectedRooms: ["Z-29"],
    roomValues: { "Z-29": { "DIM-001": 120 } },
  });
  const rows = engine.buildEvaluationRows(DATA, state);
  const area = rows.find((r) => r.areaOverride);
  assert.equal(area.evalResult.perMarket.schedule_m.status, "non_compliant");
  assert.equal(area.evalResult.perMarket.us_fda.status, "not_regulated");
  assert.equal(area.areaOverride.min, 150);
});

test("cleanroom grade: entered grade must meet the room's designated grade", () => {
  const state = makeState({
    targetMarkets: ["schedule_m"],
    selectedRooms: ["Z-29"],
    roomValues: { "Z-29": { "HVAC-001": "Grade B" } },
  });
  const rows = engine.buildEvaluationRows(DATA, state);
  const grade = rows.find((r) => r.gradeOverride);
  assert.equal(grade.gradeOverride.required, "Grade A (ISO 5)");
  assert.equal(grade.evalResult.perMarket.schedule_m.status, "non_compliant");
});

test("recommendations: name the failing room and the strictest driving authority", () => {
  const state = makeState({
    targetMarkets: ["eu_gmp", "japan_pmda"],
    selectedRooms: ["Z-29"],
    roomValues: { "Z-29": { "HVAC-002": { min: 19, max: 24 }, "DIM-001": 120 } },
  });
  const rows = engine.buildEvaluationRows(DATA, state);
  const recs = engine.buildRecommendations(DATA, state, rows);
  const temp = recs.find((r) => r.id === "THR-001-Z-29");
  assert.ok(temp, "temperature recommendation present");
  assert.match(temp.text, /Temperature in 'Aseptic Filling Suite/);
  assert.match(temp.text, /18–22/);
  assert.match(temp.text, /EU-GMP/);
});

test("market rollup: a Critical failure makes the authority Non-Compliant", () => {
  const state = makeState({ targetMarkets: ["eu_gmp", "uk_mhra"], facilityValues: { "UTIL-001": "Class 2" } });
  const rows = engine.buildEvaluationRows(DATA, state);
  const rollup = engine.computeMarketRollup(DATA, state, rows);
  assert.equal(rollup.eu_gmp, "Non-Compliant"); // THR-018 is Critical
  assert.equal(rollup.uk_mhra, "Not Covered by Dataset");
});

test("boolean checklist: a missing required feature is non-compliant", () => {
  const state = makeState({
    category: "osd_production",
    selectedRooms: ["Z-24"],
    roomValues: { "Z-24": { "DFS-001": false } },
  });
  const rows = engine.buildBooleanRows(DATA, state);
  const dust = rows.find((r) => r.threshold.id === "THR-B01");
  assert.equal(dust.status, "non_compliant");
});

test("every covered authority key used in tests exists", () => {
  for (const k of ALL_COVERED) assert.ok(DATA.authorityByKey[k], k);
});
