#!/usr/bin/env node
// Production build (Vercel runs this; see vercel.json). Copies only what the
// page loads into the output directory, writes config.js from the environment,
// pins the CSP connect-src to the configured Supabase origin, and fails if the
// output contains anything that looks like a secret.
//
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_ANON_KEY=<anon or publishable key> node scripts/build.js [--out dist]
//   LOCAL_BUILD=1 also allows http://127.0.0.1 / localhost URLs (local testing only).
const fs = require("node:fs");
const path = require("node:path");
const { scanFiles } = require("./secret-scan.js");

const ROOT = path.join(__dirname, "..");

function fail(msg) {
  console.error("build failed: " + msg);
  process.exit(1);
}

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
}

// ---------------------------------------------------------------- environment

function checkUrl(url, allowLocal) {
  if (!url) fail("SUPABASE_URL is not set");
  if (/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) return url;
  if (allowLocal && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url)) return url;
  fail(`SUPABASE_URL must look like https://<project-ref>.supabase.co (got "${url}")`);
}

function checkKey(key) {
  if (!key) fail("SUPABASE_ANON_KEY is not set");
  if (key.startsWith("sb_")) {
    if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return key;
    fail("SUPABASE_ANON_KEY must be the publishable key (sb_publishable_...), never a secret key");
  }
  let role;
  try {
    role = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8")).role;
  } catch {
    fail("SUPABASE_ANON_KEY is neither a publishable key nor a JWT");
  }
  if (role !== "anon") fail(`SUPABASE_ANON_KEY must be the anon key (its role is "${role}")`);
  return key;
}

// ---------------------------------------------------------------- files

function shippedFiles() {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]).filter((s) => s !== "config.js");
  const styles = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "manifest.json"), "utf8"));
  const data = ["manifest.json", ...Object.keys(manifest.files)].map((f) => "data/" + f);
  // The PDF reader and OCR engine load only when a planner picks a PDF, so
  // index.html doesn't reference them; ship their vendored folders whole.
  const listDir = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? listDir(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
  const lazy = fs.readdirSync(path.join(ROOT, "vendor"), { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^(pdfjs|tesseract)-\d/.test(e.name))
    .flatMap((e) => listDir(`vendor/${e.name}`));
  return ["index.html", ...styles, ...scripts, ...data, ...lazy];
}

function cspWithOrigin(origin) {
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
  const header = vercel.headers.find((h) => h.source === "/(.*)").headers.find((h) => h.key === "Content-Security-Policy").value;
  return header
    .split(";")
    .map((d) => d.trim())
    .filter((d) => d && !d.startsWith("frame-ancestors")) // not allowed in <meta>; the header carries it
    .map((d) => (d.startsWith("connect-src") ? `connect-src 'self' ${origin}` : d))
    .join("; ") + ";";
}

function prepareOut(out) {
  const resolved = path.resolve(out);
  if (resolved === ROOT || ROOT.startsWith(resolved + path.sep)) fail(`refusing to build into ${resolved}`);
  if (fs.existsSync(resolved)) {
    const isOwnDist = resolved === path.join(ROOT, "dist");
    if (!isOwnDist && fs.readdirSync(resolved).length) fail(`output directory ${resolved} is not empty`);
    if (isOwnDist) fs.rmSync(resolved, { recursive: true, force: true });
  }
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

// ---------------------------------------------------------------- main

const url = checkUrl(process.env.SUPABASE_URL, process.env.LOCAL_BUILD === "1");
const key = checkKey(process.env.SUPABASE_ANON_KEY);
// Optional: Cloudflare Turnstile site key (public) turns on the sign-in CAPTCHA.
// Supabase must have CAPTCHA protection enabled with the matching secret key.
const turnstile = process.env.TURNSTILE_SITE_KEY || null;
if (turnstile && !/^[0-9]x[0-9A-Za-z_-]{10,80}$/.test(turnstile)) fail("TURNSTILE_SITE_KEY must be a Cloudflare Turnstile site key (0x…)");
const out = prepareOut(argValue("--out", "dist"));

for (const rel of shippedFiles()) {
  const src = path.join(ROOT, rel);
  if (!fs.existsSync(src)) fail(`missing ${rel}`);
  fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true });
  fs.copyFileSync(src, path.join(out, rel));
}

fs.writeFileSync(
  path.join(out, "config.js"),
  `// Generated by scripts/build.js — public client configuration only.\nwindow.APP_CONFIG = Object.freeze({\n  supabaseUrl: ${JSON.stringify(url)},\n  supabaseAnonKey: ${JSON.stringify(key)},\n  turnstileSiteKey: ${JSON.stringify(turnstile)},\n});\n`
);

const htmlPath = path.join(out, "index.html");
const html = fs.readFileSync(htmlPath, "utf8");
if (!html.includes('<meta charset="UTF-8">')) fail("index.html has no charset meta to anchor the CSP");
fs.writeFileSync(htmlPath, html.replace('<meta charset="UTF-8">', `<meta charset="UTF-8">\n<meta http-equiv="Content-Security-Policy" content="${cspWithOrigin(url)}">`));

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
const findings = scanFiles(walk(out), { shipped: true });
if (findings.length) fail("secret scan:\n" + findings.map((f) => `  ${path.relative(out, f.file)}:${f.line}: ${f.kind}`).join("\n"));

console.log(`built ${walk(out).length} files into ${path.relative(ROOT, out) || out} for ${url}`);
