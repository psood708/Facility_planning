// T6: retention. 6 months after the last edit a project is flagged; 30 days
// after flagging it is permanently deleted. Any edit un-flags. The jobs take
// p_now so the boundaries can be tested exactly.
const test = require("node:test");
const { before, after } = test;
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { admin, signedInUser, deleteUser, projectRow } = require("./helpers.js");

const NOW = new Date("2026-12-01T00:00:00Z");
const DAY = 24 * 3600 * 1000;
const monthsAgo = (m, extraDays = 0) => {
  const d = new Date(NOW);
  d.setUTCMonth(d.getUTCMonth() - m);
  return new Date(d.getTime() - extraDays * DAY).toISOString();
};
const daysAgo = (n) => new Date(NOW.getTime() - n * DAY).toISOString();
const iso = (t) => (t === null ? null : new Date(t).toISOString());

let U;
before(async () => { U = await signedInUser("retention"); });
after(async () => { await deleteUser(U); });

// Service-role insert: lets the test backdate retention columns.
async function seed(name, cols) {
  const { data, error } = await admin.from("projects").insert({ ...projectRow({ name }), owner_id: U.id, ...cols }).select().single();
  if (error) throw error;
  return data;
}
const get = async (id) => (await admin.from("projects").select("*").eq("id", id).maybeSingle()).data;
async function rpc(fn, now = NOW) {
  const r = await admin.rpc(fn, { p_now: now.toISOString() });
  if (r.error) throw r.error;
  return r.data;
}

test("flags a project at 6 months + 1 day, not at 6 months − 1 day", async () => {
  const old = await seed("old", { last_edited_at: monthsAgo(6, 1) });
  const young = await seed("young", { last_edited_at: monthsAgo(6, -1) });
  await rpc("flag_expired_projects");
  assert.equal(iso((await get(old.id)).flagged_for_deletion_at), NOW.toISOString());
  assert.equal((await get(young.id)).flagged_for_deletion_at, null);
});

test("flagging is idempotent: a later run does not move the flag date", async () => {
  const p = await seed("twice", { last_edited_at: monthsAgo(7) });
  await rpc("flag_expired_projects");
  const first = iso((await get(p.id)).flagged_for_deletion_at);
  const n = await rpc("flag_expired_projects", new Date(NOW.getTime() + 3 * DAY));
  assert.equal(iso((await get(p.id)).flagged_for_deletion_at), first);
  assert.equal(typeof n, "number");
});

test("purges 30 days after flagging, not 29", async () => {
  const day29 = await seed("day29", { last_edited_at: monthsAgo(8), flagged_for_deletion_at: daysAgo(29) });
  const day30 = await seed("day30", { last_edited_at: monthsAgo(8), flagged_for_deletion_at: daysAgo(30) });
  const ancient = await seed("ancient-unflagged", { last_edited_at: monthsAgo(24) });
  const deleted = await rpc("purge_flagged_projects");
  assert.ok(deleted >= 1);
  assert.notEqual(await get(day29.id), null, "day 29 must be kept");
  assert.equal(await get(day30.id), null, "day 30 must be deleted");
  assert.notEqual(await get(ancient.id), null, "never purge a row that was not flagged first");
});

test("an edit during the grace period saves the project from the purge", async () => {
  const p = await seed("saved", { last_edited_at: monthsAgo(8), flagged_for_deletion_at: daysAgo(29) });
  const { error } = await U.client.from("projects").update({ notes: "Keep this project" }).eq("id", p.id);
  assert.equal(error, null);
  await rpc("purge_flagged_projects", new Date(NOW.getTime() + 5 * DAY));
  const row = await get(p.id);
  assert.notEqual(row, null);
  assert.equal(row.flagged_for_deletion_at, null);
});

test("signed-in users cannot run the retention jobs", async () => {
  for (const fn of ["flag_expired_projects", "purge_flagged_projects"]) {
    const { error } = await U.client.rpc(fn, { p_now: NOW.toISOString() });
    assert.ok(error, `${fn} callable by authenticated`);
  }
});

test("jobs are scheduled daily with pg_cron", () => {
  // cron.job is not exposed over the API; read it through the db container.
  const out = execFileSync("docker", ["exec", "supabase_db_facility-planning", "psql", "-U", "postgres", "-tAc",
    "select jobname || '|' || schedule || '|' || command from cron.job order by jobname"], { encoding: "utf8" });
  assert.match(out, /flag-expired-projects\|[^|]+\|.*flag_expired_projects\(\)/);
  assert.match(out, /purge-flagged-projects\|[^|]+\|.*purge_flagged_projects\(\)/);
});
