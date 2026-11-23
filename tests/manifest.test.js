// T1: saved projects pin the exact benchmark data + engine they were evaluated
// with. data/manifest.json must always describe the data files on disk.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { computeManifest, DATA_FILES } = require("../scripts/manifest.js");
const engine = require("../engine.js");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");

test("committed data/manifest.json matches the data files on disk (re-run `node scripts/manifest.js`)", () => {
  const committed = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "manifest.json"), "utf8"));
  assert.deepEqual(committed, computeManifest(DATA_DIR));
});

test("manifest covers every data file the app loads, with a combined content hash", () => {
  const m = computeManifest(DATA_DIR);
  const onDisk = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json") && f !== "manifest.json").sort();
  assert.deepEqual(Object.keys(m.files).sort(), onDisk);
  assert.deepEqual([...DATA_FILES].sort(), onDisk);
  for (const h of Object.values(m.files)) assert.match(h, /^[0-9a-f]{64}$/);
  assert.match(m.content_hash, /^[0-9a-f]{64}$/);
});

test("content hash changes when any data file changes", () => {
  const tmp = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "manifest-"));
  for (const f of DATA_FILES) fs.copyFileSync(path.join(DATA_DIR, f), path.join(tmp, f));
  const before = computeManifest(tmp).content_hash;
  fs.appendFileSync(path.join(tmp, "rooms.json"), " ");
  assert.notEqual(computeManifest(tmp).content_hash, before);
});

test("ENGINE_VERSION is exported and matches package.json", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(engine.ENGINE_VERSION, pkg.version);
});
