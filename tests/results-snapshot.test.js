// T8: a saved project stores a compact results snapshot (ids + statuses only)
// alongside the data hash and engine version it was computed with. On reopen:
// same versions -> recompute, which must equal the snapshot; different
// versions -> show the stored snapshot read-only and offer Re-evaluate.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadData, makeState, engine } = require("./helpers.js");
const snap = require("../results-snapshot.js");
const manifest = require("../data/manifest.json");

const DATA = loadData();
const VERSIONS = { dataHash: manifest.content_hash, engineVersion: engine.ENGINE_VERSION };

const state = () =>
  makeState({
    category: "sterile",
    specificForms: ["Sterile Liquid (Vial)"],
    targetMarkets: ["schedule_m", "eu_gmp"],
    selectedRooms: ["Z-29"],
    facilityValues: { "UTIL-001": "Class 2" },
    roomValues: { "Z-29": { "DIM-001": 120, "HVAC-001": "Grade B", "HVAC-002": { min: 19, max: 24 } } },
  });

test("evaluateAll matches what the results page computes piece by piece", () => {
  const s = state();
  const all = engine.evaluateAll(DATA, s);
  const rows = engine.buildEvaluationRows(DATA, s);
  assert.equal(all.rows.length, rows.length);
  assert.equal(all.booleanRows.length, engine.buildBooleanRows(DATA, s).length);
  assert.deepEqual(all.recommendations.map((r) => r.id), engine.buildRecommendations(DATA, s, rows).map((r) => r.id));
  assert.deepEqual(all.structural.map((f) => f.id), engine.checkStructuralFlags(DATA, s).map((f) => f.id));
  assert.deepEqual(Object.keys(all.rollup), s.targetMarkets);
});

test("snapshot covers every covered authority, whatever markets were ticked", () => {
  const saved = snap.buildSnapshot(DATA, state(), VERSIONS); // ticked: Schedule M + EU-GMP
  assert.equal(saved.snapshot_version, 2);
  assert.deepEqual(saved.markets, ["schedule_m", "us_fda", "eu_gmp", "who_gmp", "china_nmpa", "japan_pmda"]);
  const sn = snap.expand(saved, DATA);
  assert.equal(sn.data_hash, VERSIONS.dataHash);
  assert.equal(sn.engine_version, VERSIONS.engineVersion);
  assert.deepEqual(Object.keys(sn.rollup), ["schedule_m", "us_fda", "eu_gmp", "who_gmp", "china_nmpa", "japan_pmda"]);
  assert.equal(sn.rollup.schedule_m, "Partial");
  assert.equal(sn.rollup.eu_gmp, "Non-Compliant");
  const util = sn.evaluations.find((e) => e.param === "UTIL-001");
  assert.deepEqual(util.markets.schedule_m, { status: "not_regulated", fallback: "non_compliant" });
  assert.deepEqual(util.markets.eu_gmp, { status: "non_compliant", fallback: null });
  assert.deepEqual(Object.keys(util.markets), Object.keys(sn.rollup));
});

test("each saved gap keeps its obligation; the live results also carry its suggested change", () => {
  const sn = snap.buildSnapshot(DATA, state(), VERSIONS);
  assert.ok(sn.recommendations.length > 0);
  for (const r of sn.recommendations) {
    assert.deepEqual(Object.keys(r).sort(), ["basis", "id", "obligation", "severity"], "suggested changes are recomputed, not saved");
    assert.ok(["mandatory", "recommended", "unclassified"].includes(r.obligation), r.obligation);
    assert.ok(["authority", "fallback"].includes(r.basis), r.basis);
  }
  const live = snap.compact(engine.evaluateAll(DATA, engine.reportState(DATA, state())), engine.reportState(DATA, state()));
  for (const r of live.recommendations) assert.ok(r.change.length > 25, r.change);
  const json = JSON.stringify(sn);
  assert.doesNotMatch(json, /Citation pending|"note"|"provenance"|"citations"/);
  assert.ok(json.length < 40_000, `snapshot is ${json.length} bytes`);
});

test("older saves (ticked markets only, gaps without obligation or change) still reconcile as current", () => {
  const s = state();
  const old = JSON.parse(JSON.stringify({ ...snap.compact(engine.evaluateAll(DATA, s), s), snapshot_version: 1, data_hash: VERSIONS.dataHash, engine_version: VERSIONS.engineVersion }));
  old.recommendations = old.recommendations.map((r) => ({ id: r.id, severity: r.severity }));
  assert.deepEqual(Object.keys(old.rollup), ["schedule_m", "eu_gmp"], "precondition: an old-style snapshot");
  const r = snap.reconcile(DATA, { inputs: s, results_snapshot: old, data_hash: VERSIONS.dataHash, engine_version: VERSIONS.engineVersion }, VERSIONS);
  assert.equal(r.status, "current", r.reasons.join());
  assert.deepEqual(Object.keys(r.snapshot.rollup), ["schedule_m", "us_fda", "eu_gmp", "who_gmp", "china_nmpa", "japan_pmda"], "reopened results cover every authority");
});

test("snapshot is deterministic (stable ordering)", () => {
  assert.deepEqual(snap.buildSnapshot(DATA, state(), VERSIONS), snap.buildSnapshot(DATA, state(), VERSIONS));
});

test("acceptance 2: save → JSON → reopen with same versions → recompute equals snapshot", () => {
  const saved = JSON.parse(JSON.stringify({ inputs: state(), results_snapshot: snap.buildSnapshot(DATA, state(), VERSIONS), data_hash: VERSIONS.dataHash, engine_version: VERSIONS.engineVersion }));
  const r = snap.reconcile(DATA, saved, VERSIONS);
  assert.equal(r.status, "current");
  assert.deepEqual(r.reasons, []);
  assert.deepEqual(r.snapshot, snap.expand(saved.results_snapshot, DATA));
});

test("data or engine changed → stale: stored snapshot returned read-only with reasons", () => {
  const sn = snap.buildSnapshot(DATA, state(), VERSIONS);
  const project = { inputs: state(), results_snapshot: sn, data_hash: "0".repeat(64), engine_version: "0.1.0" };
  const r = snap.reconcile(DATA, project, VERSIONS);
  assert.equal(r.status, "stale");
  assert.deepEqual(r.reasons.sort(), ["data", "engine"]);
  assert.deepEqual(r.snapshot, snap.expand(sn, DATA), "the stored results, read in the page's form");
  assert.ok(Object.isFrozen(r.snapshot), "stale snapshot is read-only");
  assert.deepEqual(snap.reconcile(DATA, { ...project, engine_version: VERSIONS.engineVersion }, VERSIONS).reasons, ["data"]);
});

test("same versions but recompute differs → inconsistent (never silently trusted)", () => {
  const sn = snap.buildSnapshot(DATA, state(), VERSIONS);
  sn.rollup.eu_gmp = "Compliant"; // tampered or corrupted
  const r = snap.reconcile(DATA, { inputs: state(), results_snapshot: sn, data_hash: VERSIONS.dataHash, engine_version: VERSIONS.engineVersion }, VERSIONS);
  assert.equal(r.status, "inconsistent");
  assert.notDeepEqual(r.snapshot, sn, "returns the freshly computed snapshot");
});

test("no stored snapshot: current versions recompute; old versions need re-evaluation", () => {
  const base = { inputs: state(), results_snapshot: null };
  assert.equal(snap.reconcile(DATA, { ...base, data_hash: VERSIONS.dataHash, engine_version: VERSIONS.engineVersion }, VERSIONS).status, "current");
  const old = snap.reconcile(DATA, { ...base, data_hash: "0".repeat(64), engine_version: VERSIONS.engineVersion }, VERSIONS);
  assert.equal(old.status, "stale");
  assert.equal(old.snapshot, null);
});

test("compact over the report state is the snapshot body without version fields (shared by the results page)", () => {
  const s = engine.reportState(DATA, state());
  const sn = snap.buildSnapshot(DATA, state(), VERSIONS);
  const body = snap.compact(engine.evaluateAll(DATA, s), s);
  const { snapshot_version, data_hash, engine_version, ...rest } = snap.expand(sn, DATA);
  body.recommendations = body.recommendations.map(({ change, ...r }) => r);
  assert.deepEqual(rest, body);
});

// Older saves could include an authority without data; loading drops it from
// the inputs. The saved results are then compared only over the markets the
// project still has, so the project reads as current, not "inconsistent".
test("reconcile ignores saved markets the project no longer has (dropped authorities without data)", () => {
  // An old-style save: only the ticked markets, one of them without data.
  const withUncovered = { ...state(), targetMarkets: ["schedule_m", "uk_mhra"], primaryAuthority: "schedule_m" };
  const saved = JSON.parse(JSON.stringify(snap.compact(engine.evaluateAll(DATA, withUncovered), withUncovered)));
  assert.ok("uk_mhra" in saved.rollup, "precondition: the old save lists the no-data market");
  const loaded = { ...withUncovered, targetMarkets: ["schedule_m"] };
  const r = snap.reconcile(DATA, { inputs: loaded, results_snapshot: saved, data_hash: VERSIONS.dataHash, engine_version: VERSIONS.engineVersion }, VERSIONS);
  assert.equal(r.status, "current", r.reasons.join());
  assert.equal("uk_mhra" in r.snapshot.rollup, false, "authorities without data never come back");
  assert.ok("us_fda" in r.snapshot.rollup, "reopened results cover every covered authority");
});

test("reconcile still reports real differences in the markets the project keeps", () => {
  const s = { ...state(), primaryAuthority: "schedule_m" };
  const saved = JSON.parse(JSON.stringify(snap.buildSnapshot(DATA, s, VERSIONS)));
  saved.rollup[s.targetMarkets[0]] = "Compliant";
  assert.equal(snap.reconcile(DATA, { inputs: s, results_snapshot: saved, data_hash: VERSIONS.dataHash, engine_version: VERSIONS.engineVersion }, VERSIONS).status, "inconsistent");
});


// ---------------------------------------------------------------- size and old formats (review)

const pgBytes = (o) => Buffer.byteLength(JSON.stringify(o).replace(/":/g, '": ').replace(/,"/g, ', "')); // jsonb::text spacing
function failingEverywhere(rooms) {
  const params = DATA.parameters.filter((p) => p.applicability.sterile);
  const ps = require("../project-state.js");
  const val = (p) => { const k = ps.resolveInputKind(p); return k === "number" ? -50 : k === "number-range" ? { min: -50, max: -50 } : k === "boolean" ? false : k === "boolean-text" ? { value: false, text: "" } : k === "select" ? "zzz" : "x"; };
  const fv = Object.fromEntries(params.map((p) => [p.id, val(p)]));
  return makeState({ category: "sterile", specificForms: ["x"], selectedRooms: rooms, facilityValues: fv, roomValues: Object.fromEntries(rooms.map((r) => [r, { ...fv, "DIM-001": -50 }])) });
}

test("saved results stay well under the 256 KB database limit, even in the worst case", () => {
  const sterile = DATA.rooms.filter((r) => r.applies_to.sterile).map((r) => r.id);
  const worst = pgBytes(snap.buildSnapshot(DATA, failingEverywhere(sterile), VERSIONS));
  assert.ok(worst < 128 * 1024, `every sterile room failing: ${worst} bytes`);
  const crafted = pgBytes(snap.buildSnapshot(DATA, failingEverywhere(DATA.rooms.map((r) => r.id)), VERSIONS));
  assert.ok(crafted < 0.9 * 256 * 1024, `all ${DATA.rooms.length} rooms (crafted): ${crafted} bytes`);
});

test("expand reads both the old (object) and new (coded) saved formats the same way", () => {
  const s = engine.reportState(DATA, state());
  const live = snap.compact(engine.evaluateAll(DATA, s), s);
  live.recommendations = live.recommendations.map(({ change, ...r }) => r);
  assert.deepEqual(snap.expand(live, DATA).evaluations, live.evaluations, "old object form passes through");
  assert.deepEqual(snap.expand(snap.buildSnapshot(DATA, state(), VERSIONS), DATA).evaluations, live.evaluations, "coded form decodes to it");
});

test("PIC/S-only old saves are read as the combined EU authority", () => {
  const s = { ...state(), targetMarkets: ["schedule_m", "pics"] };
  const old = JSON.parse(JSON.stringify(snap.compact(engine.evaluateAll(DATA, s), s)));
  assert.ok("pics" in old.rollup);
  const project = { inputs: s, results_snapshot: old, data_hash: VERSIONS.dataHash, engine_version: VERSIONS.engineVersion };
  assert.equal(snap.reconcile(DATA, project, VERSIONS).status, "current");
  const tampered = JSON.parse(JSON.stringify(old));
  tampered.rollup.pics = "Compliant";
  tampered.evaluations.forEach((e) => { if (e.markets.pics) e.markets.pics.status = "compliant"; });
  assert.equal(snap.reconcile(DATA, { ...project, results_snapshot: tampered }, VERSIONS).status, "inconsistent", "a change in PIC/S results is noticed");
  const stale = snap.reconcile(DATA, { ...project, data_hash: "0".repeat(64) }, VERSIONS);
  assert.ok("eu_gmp" in stale.snapshot.rollup && !("pics" in stale.snapshot.rollup), "stale view keyed by the report authority");
});

test("a save sharing no authority with the report cannot be verified, so it is not reported as current", () => {
  const s = { ...state(), targetMarkets: ["uk_mhra"] };
  const old = JSON.parse(JSON.stringify(snap.compact(engine.evaluateAll(DATA, s), s)));
  const r = snap.reconcile(DATA, { inputs: { ...s, targetMarkets: [] }, results_snapshot: old, data_hash: VERSIONS.dataHash, engine_version: VERSIONS.engineVersion }, VERSIONS);
  assert.equal(r.status, "inconsistent");
});
