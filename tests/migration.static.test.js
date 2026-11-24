// T4: static guards on the Supabase migrations — runs without Docker.
// Behavioural RLS/trigger tests against a real database live in db-tests/
// (npm run test:db). These catch the most dangerous regressions early: a new
// table without row-level security, or anon access to project data.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const MIG_DIR = path.join(__dirname, "..", "supabase", "migrations");
const files = fs.existsSync(MIG_DIR) ? fs.readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql")).sort() : [];
// Strip -- comments so commented-out SQL never satisfies a check.
const sql = files.map((f) => fs.readFileSync(path.join(MIG_DIR, f), "utf8")).join("\n").replace(/--[^\n]*/g, "").toLowerCase();

const tables = [...sql.matchAll(/create table (?:if not exists )?(?:public\.)?([a-z_]+)/g)].map((m) => m[1]);

test("migrations exist and use timestamped names", () => {
  assert.ok(files.length > 0, "no migrations in supabase/migrations");
  for (const f of files) assert.match(f, /^\d{14}_[a-z0-9_]+\.sql$/, f);
});

test("defines the projects table", () => {
  assert.ok(tables.includes("projects"), `tables: ${tables.join(", ")}`);
});

test("every table has row level security enabled AND forced", () => {
  for (const t of tables) {
    assert.match(sql, new RegExp(`alter table (?:public\\.)?${t} enable row level security`), `${t}: RLS not enabled`);
    assert.match(sql, new RegExp(`alter table (?:public\\.)?${t} force row level security`), `${t}: RLS not forced`);
  }
});

test("projects policies cover select/insert/update/delete, only for authenticated owners", () => {
  const policies = [...sql.matchAll(/create policy [^;]+? on (?:public\.)?projects\b([^;]+);/g)].map((m) => m[1]);
  for (const cmd of ["select", "insert", "update", "delete"]) {
    const p = policies.find((x) => new RegExp(`\\bfor ${cmd}\\b`).test(x));
    assert.ok(p, `no ${cmd} policy on projects`);
    assert.match(p, /\bto authenticated\b/, `${cmd} policy must be limited to authenticated`);
    assert.match(p, /owner_id = \(select auth\.uid\(\)\)/, `${cmd} policy must compare owner_id to auth.uid()`);
  }
  assert.doesNotMatch(policies.join("\n"), /\bto (anon|public)\b/);
});

test("anon gets no privileges on projects", () => {
  assert.match(sql, /revoke all on (?:table )?(?:public\.)?projects from anon/);
  assert.doesNotMatch(sql, /grant [^;]* on (?:table )?(?:public\.)?projects to [^;]*\banon\b/);
});

test("triggers pin owner/created/retention columns on insert and update (R4/R5)", () => {
  assert.match(sql, /create trigger \w+ before insert on (?:public\.)?projects/);
  assert.match(sql, /create trigger \w+ before update on (?:public\.)?projects/);
  for (const col of ["owner_id", "created_at", "last_edited_at", "flagged_for_deletion_at"]) {
    assert.match(sql, new RegExp(`new\\.${col}`), `trigger never touches ${col}`);
  }
});

test("security definer functions pin search_path", () => {
  const defs = [...sql.matchAll(/create (?:or replace )?function[\s\S]+?\$\$;/g)].map((m) => m[0]).filter((f) => /security definer/.test(f));
  for (const f of defs) assert.match(f, /set search_path = ''/, f.slice(0, 80));
});
