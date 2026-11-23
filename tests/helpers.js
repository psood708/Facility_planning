// Shared test fixtures: load the real data/*.json the browser uses, and build
// wizard state objects without repeating every field in each test.
const fs = require("node:fs");
const path = require("node:path");
const engine = require("../engine.js");

const DATA_DIR = path.join(__dirname, "..", "data");

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${name}.json`), "utf8"));
}

function loadData() {
  const data = {};
  for (const f of ["parameters", "rooms", "thresholds", "boolean_thresholds", "authorities", "structural_flags"]) {
    data[f] = readJson(f);
  }
  const provenancePath = path.join(DATA_DIR, "provenance.json");
  if (fs.existsSync(provenancePath)) data.provenance = readJson("provenance");
  return engine.indexData(data);
}

function makeState(overrides = {}) {
  return {
    step: 4,
    category: "sterile",
    devStage: null,
    specificForms: [],
    targetMarkets: ["schedule_m"],
    scaleSize: "Medium",
    batchSize: "",
    selectedRooms: [],
    facilityValues: {},
    roomValues: {},
    ...overrides,
  };
}

function thresholdById(DATA, id) {
  const t = DATA.thresholds.find((x) => x.id === id);
  if (!t) throw new Error(`threshold ${id} not found`);
  return t;
}

module.exports = { engine, loadData, makeState, thresholdById, readJson };
