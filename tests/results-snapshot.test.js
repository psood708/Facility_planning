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

test("snapshot records versions and holds only ids and statuses", () => {
  const sn = snap.buildSnapshot(DATA, state(), VERSIONS);
  assert.equal(sn.snapshot_version, 1);
  assert.equal(sn.data_hash, VERSIONS.dataHash);
  assert.equal(sn.engine_version, VERSIONS.engineVersion);
  assert.deepEqual(sn.rollup, { schedule_m: "Partial", eu_gmp: "Non-Compliant" });
  const util = sn.evaluations.find((e) => e.param === "UTIL-001");
  assert.deepEqual(util, { room: null, param: "UTIL-001", threshold: "THR-018", markets: { schedule_m: { status: "not_regulated", fallback: "non_compliant" }, eu_gmp: { status: "non_compliant", fallback: null } } });
  // No free text, citations or entered values are copied into the snapshot.
  const json = JSON.stringify(sn);
  assert.doesNotMatch(json, /Citation pending|Class 2|note|text/);
  assert.ok(json.length < 20_000, `snapshot is ${json.length} bytes`);
});

test("snapshot is deterministic (stable ordering)", () => {
  assert.deepEqual(snap.buildSnapshot(DATA, state(), VERSIONS), snap.buildSnapshot(DATA, state(), VERSIONS));
});

test("acceptance 2: save → JSON → reopen with same versions → recompute equals snapshot", () => {
  const saved = JSON.parse(JSON.stringify({ inputs: state(), results_snapshot: snap.buildSnapshot(DATA, state(), VERSIONS), data_hash: VERSIONS.dataHash, engine_version: VERSIONS.engineVersion }));
  const r = snap.reconcile(DATA, saved, VERSIONS);
  assert.equal(r.status, "current");
  assert.deepEqual(r.reasons, []);
  assert.deepEqual(r.snapshot, saved.results_snapshot);
});

test("data or engine changed → stale: stored snapshot returned read-only with reasons", () => {
  const sn = snap.buildSnapshot(DATA, state(), VERSIONS);
  const project = { inputs: state(), results_snapshot: sn, data_hash: "0".repeat(64), engine_version: "0.1.0" };
  const r = snap.reconcile(DATA, project, VERSIONS);
  assert.equal(r.status, "stale");
  assert.deepEqual(r.reasons.sort(), ["data", "engine"]);
  assert.equal(r.snapshot, sn);
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

test("compact(all, state) is the snapshot body without version fields (shared by the results page)", () => {
  const s = state();
  const sn = snap.buildSnapshot(DATA, s, VERSIONS);
  const body = snap.compact(engine.evaluateAll(DATA, s), s);
  const { snapshot_version, data_hash, engine_version, ...rest } = sn;
  assert.deepEqual(body, rest);
});
