// T7/T8 end to end: store.js with a real supabase-js client against local
// Supabase. Proves the snapshot survives a jsonb round trip (acceptance 2)
// and that the store's "not yours = null" contract holds for real.
const test = require("node:test");
const { before, after } = test;
const assert = require("node:assert/strict");
const { signedInUser, deleteUser, admin } = require("./helpers.js");
const { loadData, makeState, engine } = require("../tests/helpers.js");
const ProjectState = require("../project-state.js");
const ResultsSnapshot = require("../results-snapshot.js");
const { createStore } = require("../store.js");
const manifest = require("../data/manifest.json");

const DATA = loadData();
const VERSIONS = { dataHash: manifest.content_hash, engineVersion: engine.ENGINE_VERSION };
const storeFor = (user, versions = VERSIONS) => createStore({ client: user.client, DATA, versions, ProjectState, ResultsSnapshot });

const state = () =>
  makeState({
    category: "sterile", specificForms: ["Sterile Liquid (Vial)"], targetMarkets: ["schedule_m", "eu_gmp"],
    selectedRooms: ["Z-29"], facilityValues: { "UTIL-001": "Class 2" },
    roomValues: { "Z-29": { "DIM-001": 120, "HVAC-001": "Grade B", "HVAC-002": { min: 19, max: 24 } } },
  });

let A, B;
before(async () => { A = await signedInUser("store-a"); B = await signedInUser("store-b"); });
after(async () => { await deleteUser(A); await deleteUser(B); });

test("acceptance 2: save → reopen → recompute equals the stored snapshot", async () => {
  const created = await storeFor(A).create({ name: "Round trip", notes: "", state: state() });
  const reopened = await storeFor(A).get(created.id);
  assert.equal(reopened.results.status, "current", reopened.results.reasons.join());
  assert.deepEqual(reopened.inputs, ProjectState.serializeInputs(state()));
});

test("reopen after a data update shows the stored snapshot as stale", async () => {
  const created = await storeFor(A).create({ name: "Old data", notes: "", state: state() });
  const p = await storeFor(A, { ...VERSIONS, dataHash: "f".repeat(64) }).get(created.id);
  assert.equal(p.results.status, "stale");
  assert.deepEqual(p.results.reasons, ["data"]);
  assert.ok(p.results.snapshot && Object.isFrozen(p.results.snapshot));
});

test("another user's project is null for get/update/keep and false for remove", async () => {
  const mine = await storeFor(A).create({ name: "Private", notes: "", state: state() });
  const sb = storeFor(B);
  assert.equal(await sb.get(mine.id), null);
  assert.equal(await sb.update(mine.id, { name: "x", notes: "", state: state() }), null);
  assert.equal(await sb.keep(mine.id), null);
  assert.equal(await sb.remove(mine.id), false);
  assert.ok(!(await sb.list()).some((p) => p.id === mine.id));
  assert.notEqual(await storeFor(A).get(mine.id), null);
});

test("keep un-flags a project; list puts flagged projects first", async () => {
  const s = storeFor(A);
  const p = await s.create({ name: "Flag me", notes: "", state: state() });
  const { error } = await admin.from("projects").update({ last_edited_at: "2026-01-01T00:00:00Z", flagged_for_deletion_at: "2026-07-02T00:00:00Z" }).eq("id", p.id);
  assert.equal(error, null);
  const list = await s.list();
  assert.equal(list[0].id, p.id);
  assert.equal(list[0].retention.state, "flagged");
  const kept = await s.keep(p.id);
  assert.equal(kept.flaggedForDeletionAt, null);
  assert.equal(kept.retention.state, "ok");
});

test("remove deletes the caller's own project", async () => {
  const s = storeFor(A);
  const p = await s.create({ name: "Temp", notes: "", state: state() });
  assert.equal(await s.remove(p.id), true);
  assert.equal(await s.get(p.id), null);
});
