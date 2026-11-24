// Results page model: one pure function turns the compact results snapshot
// (live or as saved) into what the charts draw, so the live view and the
// read-only saved view can never disagree. numericGaps() adds the live-only
// numeric comparison from evaluateAll rows.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadData, makeState, engine } = require("./helpers.js");
const snap = require("../results-snapshot.js");
const model = require("../results-model.js");

const DATA = loadData();
const LABELS = {
  market: (mk) => engine.marketLabel(DATA, mk),
  room: (id) => (DATA.roomById[id] || {}).name || id,
  param: (id) => (DATA.paramById[id] || {}).name || (id === "DIM-001-area" ? "Room Net Area" : id),
  threshold: (id) => (DATA.boolean_thresholds.find((b) => b.id === id) || {}).parameter_name || id,
};

const demo = (over = {}) =>
  makeState({
    category: "sterile",
    specificForms: ["Sterile Liquid (Vial)"],
    targetMarkets: ["schedule_m", "us_fda", "eu_gmp", "who_gmp"],
    selectedRooms: ["Z-29", "Z-01"],
    facilityValues: { "UTIL-001": "Class 2" },
    roomValues: { "Z-29": { "DIM-001": 120, "HVAC-001": "Grade B", "HVAC-002": { min: 19, max: 24 } } },
    ...over,
  });
const compactOf = (s) => snap.compact(engine.evaluateAll(DATA, s), s);
const noNaN = (v) => JSON.stringify(v, (k, x) => { if (typeof x === "number") assert.ok(Number.isFinite(x), `${k} is ${x}`); return x; });

test("markets: verdict from the rollup, counts per status, X of Y checks met", () => {
  const m = model.build(compactOf(demo()), LABELS);
  assert.deepEqual(m.markets.map((x) => x.key), ["schedule_m", "us_fda", "eu_gmp", "who_gmp"]);
  const eu = m.markets.find((x) => x.key === "eu_gmp");
  assert.equal(eu.label, "EU-GMP");
  assert.equal(eu.verdict, "Non-Compliant");
  assert.equal(eu.verdictKey, "non_compliant");
  const c = eu.counts;
  const total = c.compliant + c.non_compliant + c.not_regulated + c.not_covered + c.no_value;
  const sn = compactOf(demo());
  assert.equal(total, sn.evaluations.length + sn.checklist.length, "checklist rows count toward every market");
  assert.equal(eu.checked, c.compliant + c.non_compliant);
  assert.equal(eu.met, c.compliant);
  assert.equal(c.non_compliant, 3);
  assert.deepEqual(eu.gapsBySeverity, { Critical: 1, Significant: 1, Partial: 1 });
  noNaN(m);
});

test("fallback results never count toward an authority's verdict or gaps", () => {
  const m = model.build(compactOf(demo()), LABELS);
  const sm = m.markets.find((x) => x.key === "schedule_m");
  // UTIL-001 and HVAC-002 miss only the international standard for Schedule M.
  assert.equal(sm.counts.non_compliant, 2); // area + grade
  assert.deepEqual(sm.gapsBySeverity, { Critical: 0, Significant: 2, Partial: 0 });
});

test("fixes: id = threshold[-room]; authority first, by authorities satisfied, then severity", () => {
  const m = model.build(compactOf(demo()), LABELS);
  const ids = m.fixes.map((f) => f.id);
  assert.equal(ids[0], "GRADE-Z-29-Z-29", "grade gap fails all four markets");
  const grade = m.fixes[0];
  assert.equal(grade.satisfies, 4);
  assert.deepEqual(grade.marketsFailing, ["schedule_m", "us_fda", "eu_gmp", "who_gmp"]);
  assert.equal(grade.room, "Z-29");
  assert.match(grade.label, /Cleanroom|Grade/i);
  assert.equal(grade.basis, "authority");
  // Single-market fixes ordered by severity: Critical, Significant, Partial.
  assert.deepEqual(ids.slice(1), ["THR-018", "AREA-Z-29-Z-29", "THR-001-Z-29"]);
  assert.equal(m.fixes.find((f) => f.id === "THR-018").room, null);
});

test("severity totals and headline totals", () => {
  const m = model.build(compactOf(demo()), LABELS);
  assert.deepEqual(m.severity, { Critical: 1, Significant: 2, Partial: 1, total: 4 });
  assert.equal(m.totals.gaps, 4);
  assert.equal(m.totals.advisory, 0);
  assert.equal(m.totals.checks, compactOf(demo()).evaluations.length + compactOf(demo()).checklist.length);
  assert.equal(m.empty, false);
});

test("advisory (fallback-only) fixes are kept separate with basis 'fallback'", () => {
  // Only Schedule M: UTIL-001 Class 2 misses only the international standard.
  const m = model.build(compactOf(demo({ targetMarkets: ["schedule_m"] })), LABELS);
  const util = m.fixes.find((f) => f.id === "THR-018");
  assert.equal(util.basis, "fallback");
  assert.equal(util.satisfies, 0);
  assert.deepEqual(util.marketsFailing, ["schedule_m"]);
  assert.ok(m.fixes.indexOf(util) > m.fixes.findIndex((f) => f.basis === "authority"));
  assert.ok(m.totals.advisory >= 1);
  assert.equal(m.severity.total, m.totals.gaps, "advisory fixes are not gaps");
});

test("rooms: facility row first-class, cells per market, sorted by failures", () => {
  const m = model.build(compactOf(demo()), LABELS);
  assert.equal(m.rooms[0].room, "Z-29");
  assert.match(m.rooms[0].label, /Aseptic Filling/);
  const fac = m.rooms.find((r) => r.room === null);
  assert.equal(fac.label, "Facility");
  assert.equal(fac.cells.eu_gmp.state, "fail");
  assert.equal(fac.cells.schedule_m.state === "fail", false, "fallback miss is not a failure");
  for (let i = 1; i < m.rooms.length; i++) assert.ok(m.rooms[i - 1].failTotal >= m.rooms[i].failTotal);
  const z01 = m.rooms.find((r) => r.room === "Z-01");
  assert.equal(z01.failTotal, 0);
  assert.ok(["empty", "na", "pass"].includes(z01.cells.us_fda.state));
});

test("checklist failures count as a gap in every market", () => {
  const sn = compactOf(demo());
  const t = sn.checklist[0].threshold;
  sn.checklist[0] = { ...sn.checklist[0], status: "non_compliant" };
  sn.recommendations = sn.recommendations.concat([{ id: t + (sn.checklist[0].room ? "-" + sn.checklist[0].room : ""), severity: "Critical" }]);
  const m = model.build(sn, LABELS);
  m.markets.forEach((mk) => assert.equal(mk.gapsBySeverity.Critical >= 1, true, mk.key));
  const f = m.fixes.find((x) => x.id.startsWith(t));
  assert.equal(f.satisfies, 4);
  assert.equal(f.label, LABELS.threshold(t));
});

test("not covered markets are never green and never 'met'", () => {
  const m = model.build(compactOf(demo({ targetMarkets: ["uk_mhra"] })), LABELS);
  const uk = m.markets[0];
  assert.equal(uk.verdictKey, "not_covered");
  assert.equal(uk.met, 0);
  assert.equal(uk.checked, 0);
  assert.ok(uk.counts.not_covered > 0);
  // Checklist rows carry one status everywhere, but an uncovered authority checks nothing.
  assert.equal(uk.counts.not_covered, m.totals.checks);
  assert.deepEqual(uk.gapsBySeverity, { Critical: 0, Significant: 0, Partial: 0 });
  noNaN(m);
});

test("no values entered: insufficient data, no gaps, no_value counted", () => {
  const m = model.build(compactOf(demo({ facilityValues: {}, roomValues: {} })), LABELS);
  assert.equal(m.fixes.length, 0);
  assert.equal(m.severity.total, 0);
  m.markets.forEach((x) => { assert.equal(x.verdictKey, "insufficient"); assert.ok(x.counts.no_value > 0); });
  noNaN(m);
});

test("empty / missing snapshot pieces never throw or emit NaN", () => {
  const m = model.build({ rollup: {} }, LABELS);
  assert.equal(m.empty, true);
  assert.deepEqual(m.markets, []);
  noNaN(m);
  assert.equal(model.build(null, LABELS).empty, true);
  // Labels fall back to ids.
  const m2 = model.build(compactOf(demo()), {});
  assert.equal(m2.markets[0].label, "schedule_m");
});

test("works from a frozen snapshot read back from JSON (saved view)", () => {
  const sn = JSON.parse(JSON.stringify(compactOf(demo())));
  const deepFreeze = (o) => (o && typeof o === "object" ? (Object.values(o).forEach(deepFreeze), Object.freeze(o)) : o);
  assert.deepEqual(model.build(deepFreeze(sn), LABELS), model.build(compactOf(demo()), LABELS));
});

test("50+ rooms build quickly and stay sorted", () => {
  const rooms = DATA.rooms.map((r) => r.id);
  const m = model.build(compactOf(demo({ selectedRooms: rooms })), LABELS);
  assert.ok(m.rooms.length >= 50);
  noNaN(m);
});

// ---------------------------------------------------------------- numeric (live only)

test("numericGaps: entered numeric rows with authority bands, fallback and units", () => {
  const s = demo();
  const { rows } = engine.evaluateAll(DATA, s);
  const g = model.numericGaps(rows, s.targetMarkets, LABELS);
  const temp = g.find((x) => x.id === "THR-001-Z-29");
  assert.ok(temp, JSON.stringify(g.map((x) => x.id)));
  assert.equal(temp.unit, "°C");
  assert.deepEqual(temp.entered, { min: 19, max: 24 });
  assert.deepEqual(temp.bands.eu_gmp, { min: 18, max: 22, status: "non_compliant" });
  assert.equal(temp.bands.schedule_m.status, "not_regulated");
  assert.equal(temp.bands.schedule_m.min, null);
  assert.deepEqual({ min: temp.fallback.min, max: temp.fallback.max, status: temp.fallback.status }, { min: 18, max: 22, status: "non_compliant" });
  assert.deepEqual(temp.fallback.markets, ["schedule_m", "us_fda", "who_gmp"]);
  assert.equal(temp.state, "fail");
  assert.equal(temp.room, "Z-29");
  assert.equal(temp.severity, "Partial");
  const area = g.find((x) => x.id === "AREA-Z-29-Z-29");
  assert.equal(area.entered, 120);
  assert.equal(area.bands.schedule_m.status, "non_compliant");
  assert.ok(area.bands.schedule_m.min > 120);
  // Categorical (grade, utility class) and blank rows are excluded.
  assert.equal(g.some((x) => x.id.startsWith("GRADE-") || x.id === "THR-018"), false);
  noNaN(g);
});

test("numericGaps: fallback-only miss is 'advisory', not a failure", () => {
  const s = demo({ targetMarkets: ["schedule_m"] });
  const { rows } = engine.evaluateAll(DATA, s);
  const temp = model.numericGaps(rows, s.targetMarkets, LABELS).find((x) => x.id === "THR-001-Z-29");
  assert.equal(temp.state, "advisory");
});

// ---------------------------------------------------------------- one authority (Milestone 3)

const STATUSES = ["pass", "fail", "not_covered", "no_value"];

test("forAuthority: per room, per requirement status against one authority only", () => {
  const a = model.forAuthority(compactOf(demo()), "schedule_m", LABELS);
  assert.equal(a.key, "schedule_m");
  assert.equal(a.label, LABELS.market("schedule_m"));
  assert.equal(a.rooms[0].room, null, "facility-level requirements come first");
  assert.equal(a.rooms[0].label, "Facility");
  const rows = a.rooms.flatMap((r) => r.rows);
  for (const r of rows) assert.ok(STATUSES.includes(r.status), r.status);
  assert.equal(rows.length, STATUSES.reduce((n, k) => n + a.counts[k], 0));
  const area = a.rooms.find((r) => r.room === "Z-29").rows.find((r) => /Area/i.test(r.label));
  assert.equal(area.status, "fail", "120 m² is below Schedule M's 150 m²");
});

test("forAuthority: each status appears with real engine output", () => {
  const failing = model.forAuthority(compactOf(demo()), "schedule_m", LABELS).counts;
  assert.ok(failing.fail > 0 && failing.not_covered > 0 && failing.no_value > 0, JSON.stringify(failing));
  const passing = model.forAuthority(compactOf(demo({ roomValues: { "Z-29": { "DIM-001": 200, "HVAC-001": "Grade A (ISO 5)" } } })), "schedule_m", LABELS).counts;
  assert.ok(passing.pass > 0, JSON.stringify(passing));
});

test("forAuthority: 'sets no figure' and 'no data' both read Not covered, with the reason kept", () => {
  const snapshot = {
    rollup: { schedule_m: "Partial" },
    evaluations: [
      { room: null, param: "UTIL-001", threshold: "T1", markets: { schedule_m: { status: "not_regulated", fallback: "non_compliant" } } },
      { room: null, param: "UTIL-002", threshold: "T2", markets: { schedule_m: { status: "not_covered", fallback: null } } },
    ],
    checklist: [{ room: null, threshold: "THR-B03", status: "compliant" }],
  };
  const rows = model.forAuthority(snapshot, "schedule_m", LABELS).rooms[0].rows;
  // Passes sort before gaps in the data; the two Not covered rows keep their order and reasons.
  assert.deepEqual(rows.map((r) => [r.status, r.reason]), [["pass", null], ["not_covered", "no_figure"], ["not_covered", "no_data"]]);
  assert.equal(rows[1].advisory, "fail", "the international standard is kept as advisory, never as the status");
});

test("forAuthority: an authority outside the results gives null; the saved view gives the same answer", () => {
  const c = compactOf(demo());
  assert.equal(model.forAuthority(c, "japan_pmda", LABELS), null);
  assert.deepEqual(model.forAuthority(JSON.parse(JSON.stringify(c)), "us_fda", LABELS), model.forAuthority(c, "us_fda", LABELS));
});

test("forAuthority: within each room, failures come first, then passes, then no value, then not covered", () => {
  const rank = { fail: 0, pass: 1, no_value: 2, not_covered: 3 };
  for (const room of model.forAuthority(compactOf(demo()), "schedule_m", LABELS).rooms) {
    const ranks = room.rows.map((r) => rank[r.status]);
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), room.label);
  }
});

test("forAuthority: an unexpected saved fallback value never shows as advisory", () => {
  const snapshot = { rollup: { schedule_m: "Partial" }, evaluations: [{ room: null, param: "UTIL-001", threshold: "T1", markets: { schedule_m: { status: "not_regulated", fallback: "constructor" } } }] };
  assert.equal(model.forAuthority(snapshot, "schedule_m", LABELS).rooms[0].rows[0].advisory, null);
});
