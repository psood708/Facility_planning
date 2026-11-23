#!/usr/bin/env node
// Writes data/manifest.json: a sha256 per benchmark data file plus one combined
// content_hash. Saved projects store this hash so a project can always be tied
// to the exact data it was evaluated with (and re-checked when data changes).
//
// Run after any change to data/*.json:  node scripts/manifest.js
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DATA_FILES = [
  "authorities.json",
  "boolean_thresholds.json",
  "parameters.json",
  "provenance.json",
  "rooms.json",
  "structural_flags.json",
  "thresholds.json",
];

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

function computeManifest(dataDir) {
  const files = {};
  for (const f of DATA_FILES) files[f] = sha256(fs.readFileSync(path.join(dataDir, f)));
  // Combined hash over "name:hash" lines in fixed order — stable across platforms.
  const content_hash = sha256(DATA_FILES.map((f) => `${f}:${files[f]}`).join("\n"));
  return { manifest_version: 1, content_hash, files };
}

if (require.main === module) {
  const dataDir = path.join(__dirname, "..", "data");
  const manifest = computeManifest(dataDir);
  fs.writeFileSync(path.join(dataDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`wrote data/manifest.json (content_hash ${manifest.content_hash.slice(0, 12)}…)`);
}

module.exports = { computeManifest, DATA_FILES };
