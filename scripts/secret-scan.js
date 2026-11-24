#!/usr/bin/env node
// Secret scan (R20). Looks for secret *values*, not just words:
//   - JWTs whose payload has role "service_role"
//   - Supabase secret keys (sb_secret_<value>)
//   - database URLs with a password (postgres://user:pass@host)
//   - PEM private key blocks
// With --shipped (files deployed to browsers) the bare word "service_role" is
// also forbidden.
//
//   node scripts/secret-scan.js                 # every git-tracked file
//   node scripts/secret-scan.js --shipped dist  # a build output directory
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const RULES = [
  { kind: "supabase secret key", re: /sb_secret_[A-Za-z0-9_-]{16,}/g },
  { kind: "database URL with password", re: /postgres(?:ql)?:\/\/[^\s:@"'`/]+:[^\s@"'`/]+@/g },
  { kind: "private key", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
];
const JWT = /\b[A-Za-z0-9_-]{2,}\.([A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{2,}\b/g;

function jwtRole(payload) {
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).role;
  } catch {
    return undefined;
  }
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

function scanText(text, file, { shipped = false } = {}) {
  const findings = [];
  for (const { kind, re } of RULES) for (const m of text.matchAll(re)) findings.push({ file, line: lineOf(text, m.index), kind });
  for (const m of text.matchAll(JWT)) if (jwtRole(m[1]) === "service_role") findings.push({ file, line: lineOf(text, m.index), kind: "service_role JWT" });
  if (shipped) for (const m of text.matchAll(/service_role/g)) findings.push({ file, line: lineOf(text, m.index), kind: "mentions service_role in a shipped file" });
  return findings;
}

function scanFiles(files, opts = {}) {
  return files.flatMap((f) => {
    const buf = fs.readFileSync(f);
    if (buf.includes(0)) return []; // binary
    return scanText(buf.toString("utf8"), f, opts);
  });
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const shipped = args.includes("--shipped");
  const targets = args.filter((a) => a !== "--shipped");
  const root = path.join(__dirname, "..");
  const files = targets.length
    ? targets.flatMap((t) => (fs.statSync(t).isDirectory() ? walk(t) : [t]))
    : execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean).map((f) => path.join(root, f)).filter((f) => fs.existsSync(f));
  const findings = scanFiles(files, { shipped });
  for (const f of findings) console.error(`${path.relative(process.cwd(), f.file)}:${f.line}: ${f.kind}`);
  console.log(`secret scan: ${files.length} files, ${findings.length} finding(s)`);
  process.exit(findings.length ? 1 : 0);
}

module.exports = { scanFiles, scanText };
