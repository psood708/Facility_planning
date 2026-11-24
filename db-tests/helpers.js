// Real-database test helpers. Needs a running local stack: `npx supabase start`
// (Docker). Keys come from `supabase status`, never from the repo.
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");

const ROOT = path.join(__dirname, "..");
const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

function localEnv() {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { url: process.env.SUPABASE_URL, anon: process.env.SUPABASE_ANON_KEY, service: process.env.SUPABASE_SERVICE_ROLE_KEY };
  }
  let out;
  try {
    out = execFileSync(path.join(ROOT, "node_modules", ".bin", "supabase"), ["status", "-o", "env"], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    throw new Error("Local Supabase is not running. Start Docker Desktop, then `npx supabase start`.\n" + (e.stderr || e.message));
  }
  const env = Object.fromEntries(out.split("\n").map((l) => l.match(/^([A-Z_]+)="?(.*?)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]));
  const url = env.API_URL;
  const anon = env.ANON_KEY || env.PUBLISHABLE_KEY;
  const service = env.SERVICE_ROLE_KEY || env.SECRET_KEY;
  if (!url || !anon || !service) throw new Error("Could not read API_URL / ANON_KEY / SERVICE_ROLE_KEY from `supabase status -o env`");
  return { url, anon, service };
}

const ENV = localEnv();
const admin = createClient(ENV.url, ENV.service, NO_SESSION);
const anonClient = () => createClient(ENV.url, ENV.anon, NO_SESSION);

// Sign a fresh user in the same way the app does (one-time email link), but
// take the link from the admin API instead of an inbox.
async function signedInUser(label) {
  const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const { data: created, error: e1 } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (e1) throw e1;
  const { data: link, error: e2 } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (e2) throw e2;
  const client = anonClient();
  const { error: e3 } = await client.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: "magiclink" });
  if (e3) throw e3;
  return { id: created.user.id, email, client };
}

async function deleteUser(user) {
  if (user) await admin.auth.admin.deleteUser(user.id); // cascades to their projects
}

const HASH = "a".repeat(64);
function projectRow(overrides = {}) {
  return { name: "Test plant", notes: "", inputs: { category: "sterile" }, data_hash: HASH, engine_version: "0.2.0", ...overrides };
}

module.exports = { ENV, admin, anonClient, signedInUser, deleteUser, projectRow, HASH };
