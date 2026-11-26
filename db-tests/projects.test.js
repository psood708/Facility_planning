// T4/T5 against a real local Supabase: row level security, two-user
// isolation (R1–R3), pinned columns (R4/R5) and CHECK constraints.
// Run: npx supabase start && npm run test:db
const test = require("node:test");
const { before, after } = test;
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { admin, anonClient, signedInUser, deleteUser, projectRow } = require("./helpers.js");

let A, B, aRow;

before(async () => {
  A = await signedInUser("a");
  B = await signedInUser("b");
  const { data, error } = await A.client.from("projects").insert(projectRow({ name: "A only" })).select().single();
  if (error) throw error;
  aRow = data;
});

after(async () => {
  await deleteUser(A);
  await deleteUser(B);
});

// Compare the whole response shape, so "someone else's" == "doesn't exist".
const shape = ({ data, error, status }) => ({ data, status, code: error && error.code });

// ---------------------------------------------------------------- R1

test("R1: B reading A's project looks exactly like reading a nonexistent id", async () => {
  const theirs = await B.client.from("projects").select("*").eq("id", aRow.id).maybeSingle();
  const missing = await B.client.from("projects").select("*").eq("id", randomUUID()).maybeSingle();
  assert.equal(theirs.data, null);
  assert.deepEqual(shape(theirs), shape(missing));
});

test("R1: B updating or deleting A's project changes nothing and looks like a nonexistent id", async () => {
  const upd = await B.client.from("projects").update({ name: "hijacked" }).eq("id", aRow.id).select();
  const updMissing = await B.client.from("projects").update({ name: "hijacked" }).eq("id", randomUUID()).select();
  assert.deepEqual(shape(upd), shape(updMissing));
  assert.deepEqual(upd.data, []);

  const del = await B.client.from("projects").delete().eq("id", aRow.id).select();
  const delMissing = await B.client.from("projects").delete().eq("id", randomUUID()).select();
  assert.deepEqual(shape(del), shape(delMissing));

  const { data } = await admin.from("projects").select("name").eq("id", aRow.id).single();
  assert.equal(data.name, "A only");
});

// ---------------------------------------------------------------- R2

test("R2: B's listings never include A's row, whatever the filters", async () => {
  const { error } = await B.client.from("projects").insert(projectRow({ name: "B one" }));
  assert.equal(error, null);
  const queries = [
    B.client.from("projects").select("*"),
    B.client.from("projects").select("*").eq("owner_id", A.id),
    B.client.from("projects").select("*").order("created_at", { ascending: true }).range(0, 1000),
    B.client.from("projects").select("*").or(`owner_id.eq.${A.id},owner_id.eq.${B.id}`),
    B.client.from("projects").select("*").ilike("name", "%A only%"),
  ];
  for (const q of queries) {
    const { data, error: e } = await q;
    assert.equal(e, null);
    assert.ok(data.every((r) => r.owner_id === B.id), JSON.stringify(data));
    assert.ok(!data.some((r) => r.id === aRow.id));
  }
  const { count } = await B.client.from("projects").select("*", { count: "exact", head: true });
  assert.equal(count, 1);
});

// ---------------------------------------------------------------- R3

test("R3: signed-out callers get no data and cannot write", async () => {
  const anon = anonClient();
  const list = await anon.from("projects").select("*");
  assert.ok(list.error, "anon select should be refused");
  assert.equal(list.data, null);
  const one = await anon.from("projects").select("*").eq("id", aRow.id);
  assert.equal(one.data, null);
  const ins = await anon.from("projects").insert(projectRow());
  assert.ok(ins.error, "anon insert should be refused");
  const del = await anon.from("projects").delete().eq("id", aRow.id);
  assert.ok(del.error, "anon delete should be refused");
});

// ---------------------------------------------------------------- R4

test("R4: an owner_id in the request body is ignored — the row belongs to the caller", async () => {
  const { data, error } = await A.client.from("projects").insert(projectRow({ name: "Forged", owner_id: B.id })).select().single();
  assert.equal(error, null);
  assert.equal(data.owner_id, A.id);
  const seenByB = await B.client.from("projects").select("id").eq("id", data.id);
  assert.deepEqual(seenByB.data, []);
});

test("R4: client-supplied created_at / last_edited_at / flag on insert are overwritten", async () => {
  const { data, error } = await A.client
    .from("projects")
    .insert(projectRow({ name: "Backdated", created_at: "2000-01-01T00:00:00Z", last_edited_at: "2000-01-01T00:00:00Z", flagged_for_deletion_at: "2000-01-02T00:00:00Z" }))
    .select()
    .single();
  assert.equal(error, null);
  const recent = (t) => Math.abs(Date.now() - new Date(t).getTime()) < 5 * 60_000;
  assert.ok(recent(data.created_at), data.created_at);
  assert.ok(recent(data.last_edited_at), data.last_edited_at);
  assert.equal(data.flagged_for_deletion_at, null);
});

// ---------------------------------------------------------------- R5

for (const [col, value] of [
  ["owner_id", () => B.id],
  ["created_at", () => "2000-01-01T00:00:00Z"],
  ["last_edited_at", () => "2000-01-01T00:00:00Z"],
  ["flagged_for_deletion_at", () => new Date().toISOString()],
]) {
  test(`R5: owner cannot change ${col}`, async () => {
    const before_ = (await admin.from("projects").select("*").eq("id", aRow.id).single()).data;
    const { error } = await A.client.from("projects").update({ [col]: value() }).eq("id", aRow.id);
    assert.ok(error, `update of ${col} should be rejected`);
    const after_ = (await admin.from("projects").select("*").eq("id", aRow.id).single()).data;
    assert.equal(after_[col], before_[col]);
  });
}

test("an ordinary edit restarts the retention clock and clears a deletion flag", async () => {
  const old = "2026-01-01T00:00:00+00:00";
  // Simulate the flag job (service role is not subject to the trigger rules).
  const { error: e1 } = await admin.from("projects").update({ last_edited_at: old, flagged_for_deletion_at: "2026-07-02T00:00:00+00:00" }).eq("id", aRow.id);
  assert.equal(e1, null);
  const { data, error } = await A.client.from("projects").update({ notes: "Keep this project" }).eq("id", aRow.id).select().single();
  assert.equal(error, null);
  assert.equal(data.flagged_for_deletion_at, null);
  assert.ok(new Date(data.last_edited_at) > new Date(old));
});

// ---------------------------------------------------------------- CHECK constraints

test("database rejects malformed rows even if the browser validation is bypassed", async () => {
  const bad = [
    { name: "" },
    { name: "x".repeat(121) },
    { name: "  padded  " },
    { notes: "x".repeat(2001) },
    { inputs: [] },
    { data_hash: "not-a-hash" },
    { engine_version: "latest" },
    { results_snapshot: "text" },
  ];
  for (const o of bad) {
    const { error } = await A.client.from("projects").insert(projectRow(o));
    assert.ok(error, `accepted ${JSON.stringify(o).slice(0, 60)}`);
    assert.equal(error.code, "23514", `${JSON.stringify(o).slice(0, 60)}: ${error.message}`);
  }
});

// ---------------------------------------------------------------- per-user cap (security review #2)

test("each user can hold at most 200 projects; at the cap an insert fails with code 54000; deleting frees a slot", async () => {
  const C = await signedInUser("cap");
  try {
    const rows = Array.from({ length: 200 }, (_, i) => ({ ...projectRow({ name: `P${i}` }), owner_id: C.id }));
    const seeded = await admin.from("projects").insert(rows);
    if (seeded.error) throw seeded.error;
    const over = await C.client.from("projects").insert(projectRow({ name: "one too many" })).select();
    assert.equal(over.error && over.error.code, "54000", JSON.stringify(over.error));
    assert.match(over.error.message, /200/);
    const { count } = await C.client.from("projects").select("id", { count: "exact", head: true });
    assert.equal(count, 200, "nothing was added");
    const one = await C.client.from("projects").select("id").limit(1).single();
    await C.client.from("projects").delete().eq("id", one.data.id);
    const fits = await C.client.from("projects").insert(projectRow({ name: "fits again" })).select();
    assert.equal(fits.error, null);
    const other = await A.client.from("projects").insert(projectRow({ name: "A is unaffected" })).select();
    assert.equal(other.error, null, "the cap is per user");
  } finally {
    await deleteUser(C);
  }
});
