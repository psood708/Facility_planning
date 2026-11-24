// T11: what gets deployed and how it is served. R13 (security headers, no
// inline/unpinned scripts) and R20 (no secrets in shipped files).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { scanFiles } = require("../scripts/secret-scan.js");

const ROOT = path.join(__dirname, "..");
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));

// A syntactically valid JWT with the given role (unsigned; only the payload matters here).
const jwt = (role) => ["e30", Buffer.from(JSON.stringify({ role, iss: "supabase" })).toString("base64url"), "sig"].join(".");
const PROD = { SUPABASE_URL: "https://abcdefghijklmnop.supabase.co", SUPABASE_ANON_KEY: jwt("anon") };

function build(env, out = fs.mkdtempSync(path.join(os.tmpdir(), "dist-"))) {
  const r = spawnSync(process.execPath, ["scripts/build.js", "--out", out], { cwd: ROOT, encoding: "utf8", env: { PATH: process.env.PATH, ...env } });
  return { ...r, out };
}
const listFiles = (dir, base = dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))])).sort();

// ---------------------------------------------------------------- vercel.json

test("vercel builds the app into dist/ and serves only that", () => {
  assert.equal(vercel.buildCommand, "node scripts/build.js");
  assert.equal(vercel.outputDirectory, "dist");
});

function headersFor(source) {
  const block = vercel.headers.find((h) => h.source === source);
  assert.ok(block, `no headers for ${source}`);
  return Object.fromEntries(block.headers.map((h) => [h.key.toLowerCase(), h.value]));
}

test("R13: every response carries a strict CSP", () => {
  const csp = headersFor("/(.*)")["content-security-policy"];
  const d = Object.fromEntries(csp.split(";").map((s) => s.trim()).filter(Boolean).map((s) => { const [k, ...v] = s.split(/\s+/); return [k, v]; }));
  assert.deepEqual(d["default-src"], ["'self'"]);
  assert.deepEqual(d["script-src"], ["'self'"]);
  assert.deepEqual(d["style-src"], ["'self'"]);
  assert.deepEqual(d["object-src"], ["'none'"]);
  assert.deepEqual(d["base-uri"], ["'none'"]);
  assert.deepEqual(d["frame-ancestors"], ["'none'"]);
  assert.deepEqual(d["form-action"], ["'self'"]);
  assert.deepEqual(d["connect-src"], ["'self'", "https://*.supabase.co"]);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|\*(?!\.supabase\.co)|http:/);
});

test("R13: HSTS, nosniff, referrer policy and framing protection", () => {
  const h = headersFor("/(.*)");
  const maxAge = Number((h["strict-transport-security"].match(/max-age=(\d+)/) || [])[1]);
  assert.ok(maxAge >= 31536000, "HSTS max-age at least a year");
  assert.match(h["strict-transport-security"], /includeSubDomains/);
  assert.equal(h["x-content-type-options"], "nosniff");
  assert.equal(h["referrer-policy"], "strict-origin-when-cross-origin");
  assert.equal(h["x-frame-options"], "DENY");
  assert.match(h["permissions-policy"], /camera=\(\)/);
  assert.equal(h["cross-origin-opener-policy"], "same-origin");
});

test("R13: no inline scripts or styles, and every script is local", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  for (const tag of html.match(/<script\b[^>]*>[\s\S]*?<\/script>/g)) {
    assert.match(tag, /^<script src="[a-z0-9./_-]+\.js"( integrity="sha384-[^"]+")?><\/script>$/i, tag);
  }
  assert.doesNotMatch(html, /\sstyle=|\son[a-z]+=|<style/i);
  for (const f of ["app.js", "projects-view.js"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), "utf8"), /\bstyle:\s*["'`]/, `${f} sets an inline style attribute (blocked by CSP)`);
  }
});

// ---------------------------------------------------------------- build

test("build ships exactly the files the page loads, plus generated config", () => {
  const r = build(PROD);
  assert.equal(r.status, 0, r.stderr);
  const files = listFiles(r.out);
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
  const data = fs.readdirSync(path.join(ROOT, "data")).filter((f) => f.endsWith(".json")).map((f) => "data/" + f);
  assert.deepEqual(files, [...new Set(["index.html", "styles.css", ...scripts, ...data])].sort());
  for (const f of files) assert.doesNotMatch(f, /^(tests|db-tests|e2e|supabase|scripts|expert-review|node_modules|\.claude)\/|package|\.env/);
});

test("build writes config.js from the environment and pins connect-src to that origin", () => {
  const r = build(PROD);
  assert.equal(r.status, 0, r.stderr);
  const cfg = fs.readFileSync(path.join(r.out, "config.js"), "utf8");
  assert.match(cfg, /supabaseUrl: "https:\/\/abcdefghijklmnop\.supabase\.co"/);
  assert.ok(cfg.includes(PROD.SUPABASE_ANON_KEY));
  const html = fs.readFileSync(path.join(r.out, "index.html"), "utf8");
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="[^"]*connect-src 'self' https:\/\/abcdefghijklmnop\.supabase\.co;[^"]*">/);
});

test("build refuses a secret key, a missing value or a non-Supabase URL", () => {
  const cases = [
    [{ ...PROD, SUPABASE_ANON_KEY: jwt("service_role") }, /anon/i],
    [{ ...PROD, SUPABASE_ANON_KEY: ["sb", "secret", "abcdefghijklmnopqrstuvwxyz"].join("_") }, /publishable/i],
    [{ SUPABASE_URL: PROD.SUPABASE_URL }, /SUPABASE_ANON_KEY/],
    [{ SUPABASE_ANON_KEY: PROD.SUPABASE_ANON_KEY }, /SUPABASE_URL/],
    [{ ...PROD, SUPABASE_URL: "http://abcdefghijklmnop.supabase.co" }, /SUPABASE_URL/],
    [{ ...PROD, SUPABASE_URL: "https://evil.example.com" }, /SUPABASE_URL/],
  ];
  for (const [env, re] of cases) {
    const r = build(env);
    assert.notEqual(r.status, 0, JSON.stringify(env));
    assert.match(r.stderr, re);
  }
});

test("local builds may point at the local stack only when asked explicitly", () => {
  const local = { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_ANON_KEY: jwt("anon") };
  assert.notEqual(build(local).status, 0);
  assert.equal(build({ ...local, LOCAL_BUILD: "1" }).status, 0);
});

// ---------------------------------------------------------------- R20 secret scan

test("secret scan flags real secrets and passes a clean build", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scan-"));
  const plant = (name, body) => (fs.writeFileSync(path.join(dir, name), body), path.join(dir, name));
  // Planted values are assembled at runtime so this file itself never contains one.
  const SECRET = ["sb", "secret", "FAKEfakeFAKEfake0123456789"].join("_");
  const DB_URL = "postgresql://postgres:" + "hunter2" + "@db.example.co:5432/postgres";
  const KEY_BLOCK = ["-----BEGIN", "PRIVATE KEY-----\nMIIE\n-----END", "PRIVATE KEY-----"].join(" ");
  const bad = [
    plant("a.js", `const k = "${jwt("service_role")}";`),
    plant("b.js", `key = "${SECRET}"`),
    plant("c.txt", `DATABASE_URL=${DB_URL}`),
    plant("d.pem", KEY_BLOCK),
  ];
  for (const f of bad) assert.equal(scanFiles([f]).length, 1, f);
  // Shipped files may not even mention service_role.
  const mention = plant("e.js", "// uses the service_role key");
  assert.equal(scanFiles([mention]).length, 0);
  assert.equal(scanFiles([mention], { shipped: true }).length, 1);
  // A prefix check in library code is not a secret.
  assert.equal(scanFiles([plant("f.js", "e.startsWith(`sb_secret_`)")], { shipped: true }).length, 0);

  const r = build(PROD);
  assert.equal(scanFiles(listFiles(r.out).map((f) => path.join(r.out, f)), { shipped: true }).length, 0);
});

test("secret scan finds nothing in the committed repository", () => {
  const tracked = spawnSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  const findings = scanFiles(tracked.map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f)));
  assert.deepEqual(findings, []);
});

test(".env.example documents only public client settings, with no values", () => {
  const lines = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8").split("\n").filter((l) => l && !l.startsWith("#"));
  assert.deepEqual(lines.map((l) => l.split("=")[0]).sort(), ["SUPABASE_ANON_KEY", "SUPABASE_URL"]);
  for (const l of lines) assert.match(l, /^[A-Z_]+=$/);
  assert.match(fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8"), /^dist\/$/m);
});
