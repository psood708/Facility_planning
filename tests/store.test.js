// T7: store.js is the only code that talks to Supabase. The client is
// injected, so these tests use a fake that records every call.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadData, makeState, engine } = require("./helpers.js");
const ProjectState = require("../project-state.js");
const ResultsSnapshot = require("../results-snapshot.js");
const { createStore, retentionInfo, StoreError } = require("../store.js");
const manifest = require("../data/manifest.json");

const DATA = loadData();
const VERSIONS = { dataHash: manifest.content_hash, engineVersion: engine.ENGINE_VERSION };

// Chainable fake of supabase-js' query builder. `respond(call)` decides the
// result for each finished query; every call is recorded.
function fakeClient(respond = () => ({ data: null, error: null })) {
  const calls = [];
  const client = {
    calls,
    from(table) {
      const call = { table, ops: [] };
      calls.push(call);
      const b = {};
      for (const op of ["select", "insert", "update", "delete", "eq", "order", "limit"]) {
        b[op] = (...args) => (call.ops.push([op, ...args]), b);
      }
      b.maybeSingle = () => (call.ops.push(["maybeSingle"]), b);
      b.single = () => (call.ops.push(["single"]), b);
      b.then = (ok, bad) => Promise.resolve(respond(call)).then(ok, bad);
      return b;
    },
  };
  return client;
}
const op = (call, name) => call.ops.find((o) => o[0] === name);
const store = (client) => createStore({ client, DATA, versions: VERSIONS, ProjectState, ResultsSnapshot });

const filled = () =>
  makeState({
    category: "sterile", specificForms: ["Sterile Liquid (Vial)"], targetMarkets: ["schedule_m", "eu_gmp"],
    selectedRooms: ["Z-29"], roomValues: { "Z-29": { "DIM-001": 120 } },
  });

function savedRow(overrides = {}) {
  const inputs = ProjectState.serializeInputs(filled());
  return {
    id: "11111111-1111-4111-8111-111111111111", owner_id: "u1", name: "Plant A", notes: "", inputs,
    data_hash: VERSIONS.dataHash, engine_version: VERSIONS.engineVersion,
    results_snapshot: ResultsSnapshot.buildSnapshot(DATA, inputs, VERSIONS),
    created_at: "2026-11-01T00:00:00Z", last_edited_at: "2026-11-20T00:00:00Z", flagged_for_deletion_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------- get

test("get: missing or RLS-hidden project → null (same as nonexistent)", async () => {
  const s = store(fakeClient(() => ({ data: null, error: null })));
  assert.equal(await s.get("22222222-2222-4222-8222-222222222222"), null);
});

test("get: returns validated inputs and reconciled results", async () => {
  const row = savedRow();
  const s = store(fakeClient(() => ({ data: JSON.parse(JSON.stringify(row)), error: null })));
  const p = await s.get(row.id);
  assert.equal(p.name, "Plant A");
  assert.equal(p.results.status, "current");
  assert.deepEqual(p.inputs, ProjectState.validateInputs(row.inputs, DATA).inputs);
});

test("get: a stored payload that fails validation is refused, never loaded", async () => {
  const row = savedRow({ inputs: { ...savedRow().inputs, selectedRooms: ["NOPE"] } });
  const s = store(fakeClient(() => ({ data: row, error: null })));
  await assert.rejects(s.get(row.id), (e) => e instanceof StoreError && e.code === "invalid_project");
});

test("get: rejects ids that are not UUIDs without calling the server", async () => {
  const c = fakeClient();
  await assert.rejects(store(c).get("1 or 1=1"), (e) => e.code === "not_found");
  assert.equal(c.calls.length, 0);
});

test("server errors surface as StoreError with the server code", async () => {
  const s = store(fakeClient(() => ({ data: null, error: { code: "PGRST301", message: "JWT expired" } })));
  await assert.rejects(s.list(), (e) => e instanceof StoreError && e.code === "server" && e.serverCode === "PGRST301");
});

// ---------------------------------------------------------------- create / update

test("create: validates before sending; invalid input never reaches the server", async () => {
  const c = fakeClient();
  await assert.rejects(store(c).create({ name: "", notes: "", state: filled() }), (e) => e.code === "invalid" && /name/.test(e.errors.join()));
  const bad = filled();
  bad.selectedRooms = ["NOPE"];
  await assert.rejects(store(c).create({ name: "ok", notes: "", state: bad }), (e) => e.code === "invalid");
  assert.equal(c.calls.length, 0);
});

test("create: sends only allowed columns — never owner_id or retention fields", async () => {
  const c = fakeClient((call) => ({ data: { ...savedRow(), ...op(call, "insert")[1] }, error: null }));
  await store(c).create({ name: "  Plant B  ", notes: "n", state: filled() });
  const body = op(c.calls[0], "insert")[1];
  assert.deepEqual(Object.keys(body).sort(), ["data_hash", "engine_version", "inputs", "name", "notes", "results_snapshot"]);
  assert.equal(body.name, "Plant B");
  assert.equal(body.data_hash, VERSIONS.dataHash);
  assert.equal(body.engine_version, VERSIONS.engineVersion);
  assert.deepEqual(body.results_snapshot, ResultsSnapshot.buildSnapshot(DATA, body.inputs, VERSIONS));
  assert.equal(c.calls[0].table, "projects");
});

test("update: same column whitelist, scoped by id; missing row → null", async () => {
  const c = fakeClient(() => ({ data: null, error: null }));
  const id = "33333333-3333-4333-8333-333333333333";
  assert.equal(await store(c).update(id, { name: "x", notes: "", state: filled() }), null);
  const body = op(c.calls[0], "update")[1];
  assert.deepEqual(Object.keys(body).sort(), ["data_hash", "engine_version", "inputs", "name", "notes", "results_snapshot"]);
  assert.deepEqual(op(c.calls[0], "eq"), ["eq", "id", id]);
});

test("keep: a real write (restarts the clock) that sends no retention columns", async () => {
  const row = savedRow({ flagged_for_deletion_at: "2026-11-01T00:00:00Z" });
  const c = fakeClient((call) => (op(call, "update") ? { data: { ...row, flagged_for_deletion_at: null }, error: null } : { data: row, error: null }));
  const p = await store(c).keep(row.id);
  assert.equal(p.flaggedForDeletionAt, null);
  const upd = c.calls.find((x) => op(x, "update"));
  assert.deepEqual(Object.keys(op(upd, "update")[1]), ["name"]);
});

// ---------------------------------------------------------------- list / remove

test("list: newest edit first, only summary columns, with retention info", async () => {
  const rows = [savedRow({ id: "a", flagged_for_deletion_at: "2026-11-10T00:00:00Z", last_edited_at: "2026-05-01T00:00:00Z" }), savedRow({ id: "b" })];
  const c = fakeClient(() => ({ data: rows.map(({ inputs, results_snapshot, ...r }) => r), error: null }));
  const list = await store(c).list({ now: new Date("2026-11-24T00:00:00Z") });
  assert.doesNotMatch(op(c.calls[0], "select")[1], /inputs|results_snapshot/);
  assert.deepEqual(op(c.calls[0], "order"), ["order", "last_edited_at", { ascending: false }]);
  assert.equal(list[0].id, "a", "flagged projects sort to the top");
  assert.equal(list[0].retention.state, "flagged");
});

test("remove: true when a row was deleted, false when none matched", async () => {
  const id = "44444444-4444-4444-8444-444444444444";
  assert.equal(await store(fakeClient(() => ({ data: [{ id }], error: null }))).remove(id), true);
  assert.equal(await store(fakeClient(() => ({ data: [], error: null }))).remove(id), false);
});

// ---------------------------------------------------------------- retention

test("retentionInfo: ok → warning 30 days before flagging → flagged with deletion date", () => {
  const edited = "2026-01-15T00:00:00Z";
  const at = (d) => retentionInfo({ last_edited_at: edited, flagged_for_deletion_at: null }, new Date(d));
  assert.equal(at("2026-06-14T00:00:00Z").state, "ok");
  const w = at("2026-06-20T00:00:00Z");
  assert.equal(w.state, "warning");
  assert.equal(w.flagDate.toISOString(), "2026-07-15T00:00:00.000Z");

  const f = retentionInfo({ last_edited_at: edited, flagged_for_deletion_at: "2026-07-16T02:15:00Z" }, new Date("2026-07-26T02:15:00Z"));
  assert.equal(f.state, "flagged");
  assert.equal(f.deletionDate.toISOString(), "2026-08-15T02:15:00.000Z");
  assert.equal(f.daysLeft, 20);
});

// A project saved before primary authorities existed, with an authority that
// has no data among its markets, opens cleanly: the market is dropped, the
// primary defaults, and the results read as current (not "inconsistent").
test("get: a legacy save with an authority without data opens as current with a default primary", async () => {
  const legacyInputs = ProjectState.serializeInputs(filled());
  legacyInputs.targetMarkets = ["schedule_m", "eu_gmp", "uk_mhra"];
  delete legacyInputs.primaryAuthority;
  const row = savedRow({ inputs: legacyInputs, results_snapshot: ResultsSnapshot.buildSnapshot(DATA, legacyInputs, VERSIONS) });
  const p = await store(fakeClient(() => ({ data: JSON.parse(JSON.stringify(row)), error: null }))).get(row.id);
  assert.deepEqual(p.inputs.targetMarkets, ["schedule_m", "eu_gmp"]);
  assert.equal(p.inputs.primaryAuthority, "schedule_m");
  assert.equal(p.results.status, "current", p.results.reasons.join());
});
