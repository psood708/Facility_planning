// T9: routing, sign-in guard, email-link sign-in, and keeping auth secrets out
// of URLs (R15) and out of the repo.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { parseRoute, routeFor, scrubAuthParams, authRedirectUrl } = require("../router.js");
const { createAuth } = require("../auth.js");

const ROOT = path.join(__dirname, "..");
const ID = "11111111-1111-4111-8111-111111111111";

// ---------------------------------------------------------------- routes

test("parseRoute understands the app's hash routes", () => {
  assert.deepEqual(parseRoute(""), { name: "home" });
  assert.deepEqual(parseRoute("#/"), { name: "home" });
  assert.deepEqual(parseRoute("#/signin"), { name: "signin" });
  assert.deepEqual(parseRoute("#/projects"), { name: "projects" });
  assert.deepEqual(parseRoute("#/projects/new"), { name: "new" });
  assert.deepEqual(parseRoute(`#/projects/${ID}`), { name: "project", id: ID });
  assert.deepEqual(parseRoute(`#/projects/${ID.toUpperCase()}`), { name: "project", id: ID });
});

test("parseRoute rejects anything else as notfound", () => {
  for (const h of ["#/projects/123", "#/projects/../admin", `#/projects/${ID}/x`, "#/admin", "#javascript:alert(1)", `#/projects/${ID}?x=1`]) {
    assert.equal(parseRoute(h).name, "notfound", h);
  }
});

test("routeFor: signed out → sign in; signed in never sees the sign-in page", () => {
  const out = { configured: true, signedIn: false };
  const inn = { configured: true, signedIn: true };
  for (const h of ["", "#/projects", "#/projects/new", `#/projects/${ID}`]) assert.equal(routeFor(h, out).name, "signin", h);
  assert.equal(routeFor("#/signin", out).name, "signin");
  assert.equal(routeFor("", inn).name, "projects");
  assert.equal(routeFor("#/signin", inn).name, "projects");
  assert.deepEqual(routeFor(`#/projects/${ID}`, inn), { name: "project", id: ID });
  assert.equal(routeFor("#/nope", inn).name, "notfound");
});

test("routeFor: without Supabase config the app is the wizard only (no saving)", () => {
  const off = { configured: false, signedIn: false };
  for (const h of ["", "#/signin", "#/projects", `#/projects/${ID}`]) assert.equal(routeFor(h, off).name, "wizard-only", h);
});

// ---------------------------------------------------------------- R15

test("scrubAuthParams removes auth codes and tokens from query and hash, keeps the route", () => {
  assert.equal(scrubAuthParams("https://app.example/?code=abc123&utm=1#/projects"), "https://app.example/?utm=1#/projects");
  assert.equal(
    scrubAuthParams("https://app.example/#access_token=eyJ.x.y&refresh_token=r&expires_in=3600&token_type=bearer&type=magiclink"),
    "https://app.example/"
  );
  assert.equal(scrubAuthParams("https://app.example/?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid"), "https://app.example/");
  // Supabase Auth marks its redirects with an "sb" fragment parameter (seen in the browser e2e run).
  assert.equal(scrubAuthParams("https://app.example/#error=access_denied&error_code=otp_expired&sb="), "https://app.example/");
  assert.equal(scrubAuthParams("https://app.example/#sb="), "https://app.example/");
  assert.equal(scrubAuthParams("https://app.example/#/projects"), "https://app.example/#/projects");
});

test("the email link returns to the bare app URL — no route, query or hash carried", () => {
  assert.equal(authRedirectUrl({ origin: "https://app.example", pathname: "/" }), "https://app.example/");
  assert.equal(authRedirectUrl({ origin: "http://127.0.0.1:8000", pathname: "/index.html" }), "http://127.0.0.1:8000/index.html");
});

// ---------------------------------------------------------------- auth

function fakeSupabase(result = { error: null }) {
  const calls = [];
  return {
    calls,
    auth: {
      signInWithOtp: async (args) => (calls.push(["signInWithOtp", args]), result),
      signOut: async (args) => (calls.push(["signOut", args]), { error: null }),
    },
  };
}
const location = { origin: "https://app.example", pathname: "/" };

test("sendLink: sends a one-time link that returns to the bare app URL", async () => {
  const sb = fakeSupabase();
  const r = await createAuth({ client: sb, location }).sendLink("  Person@Example.com ");
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(sb.calls[0], ["signInWithOtp", { email: "person@example.com", options: { emailRedirectTo: "https://app.example/", shouldCreateUser: true } }]);
});

test("sendLink: malformed email is refused locally, the server is not called", async () => {
  const sb = fakeSupabase();
  for (const e of ["", "nope", "a@b", "a b@c.com", "x".repeat(250) + "@example.com"]) {
    assert.deepEqual(await createAuth({ client: sb, location }).sendLink(e), { ok: false, reason: "invalid_email" });
  }
  assert.equal(sb.calls.length, 0);
});

test("sendLink: the same answer whatever the server says about the account (R9)", async () => {
  const outcomes = [{ error: null }, { error: { status: 400, code: "user_not_found", message: "User not found" } }, { error: { status: 422, code: "signup_disabled", message: "x" } }];
  for (const o of outcomes) assert.deepEqual(await createAuth({ client: fakeSupabase(o), location }).sendLink("a@example.com"), { ok: true });
});

test("sendLink: rate limiting is reported so the UI can ask the user to wait", async () => {
  const sb = fakeSupabase({ error: { status: 429, code: "over_email_send_rate_limit", message: "slow down" } });
  assert.deepEqual(await createAuth({ client: sb, location }).sendLink("a@example.com"), { ok: false, reason: "rate_limited" });
});

test("signOut ends the session everywhere (revokes refresh tokens)", async () => {
  const sb = fakeSupabase();
  await createAuth({ client: sb, location }).signOut();
  assert.deepEqual(sb.calls[0], ["signOut", { scope: "global" }]);
});

// ---------------------------------------------------------------- vendored client + config

test("vendored supabase-js matches the pinned devDependency and index.html's integrity hash", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const version = pkg.devDependencies["@supabase/supabase-js"];
  const rel = `vendor/supabase-js-${version}.js`;
  const file = fs.readFileSync(path.join(ROOT, rel));
  assert.ok(file.equals(fs.readFileSync(path.join(ROOT, "node_modules/@supabase/supabase-js/dist/umd/supabase.js"))), "vendored copy differs from the package");
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const tag = html.match(new RegExp(`<script src="${rel.replace(/[.]/g, "\\.")}" integrity="(sha384-[^"]+)"></script>`));
  assert.ok(tag, `index.html must load ${rel} with an integrity attribute`);
  assert.equal(tag[1], "sha384-" + crypto.createHash("sha384").update(file).digest("base64"));
});

test("config.js holds only the public URL and a public (anon/publishable) key", () => {
  const src = fs.readFileSync(path.join(ROOT, "config.js"), "utf8");
  const ctx = { window: {} };
  vm.runInNewContext(src, ctx);
  assert.deepEqual(Object.keys(ctx.window.APP_CONFIG).sort(), ["supabaseAnonKey", "supabaseUrl"]);
  const { supabaseUrl, supabaseAnonKey } = ctx.window.APP_CONFIG;
  assert.match(supabaseUrl, /^(https:\/\/[a-z0-9-]+\.supabase\.co|http:\/\/127\.0\.0\.1:54321)$/);
  if (supabaseAnonKey.startsWith("sb_")) assert.match(supabaseAnonKey, /^sb_publishable_/);
  else assert.equal(JSON.parse(Buffer.from(supabaseAnonKey.split(".")[1], "base64url")).role, "anon");
  assert.doesNotMatch(src, /service_role|sb_secret_/);
});
