// T2 / R6: saved project payloads are untrusted input. They are validated
// against a strict schema and copied field-by-field into wizard state — never
// Object.assign'ed — so a stored payload cannot inject keys or bad values.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadData, makeState } = require("./helpers.js");
const ps = require("../project-state.js");

const DATA = loadData();

function paramOfKind(kind) {
  // Skip DIM-001 (room area): fixtures set it separately in roomValues.
  const p = DATA.parameters.find((x) => x.id !== "DIM-001" && ps.resolveInputKind(x) === kind);
  if (!p) throw new Error(`no parameter of kind ${kind}`);
  return p;
}

const ROOM0 = DATA.rooms[0].id;
const NUM = paramOfKind("number").id;
const RANGE = paramOfKind("number-range").id;
const BOOL = paramOfKind("boolean").id;
const BT = paramOfKind("boolean-text").id;
const TEXT = paramOfKind("text").id;

function filledState() {
  return makeState({
    step: 3,
    category: "osd_rnd_pilot",
    devStage: "Pilot Plant",
    specificForms: ["Capsule", "Tablet (Coated)"],
    targetMarkets: ["schedule_m", "us_fda"],
    scaleSize: "Large",
    batchSize: "50,000 tablets",
    selectedRooms: [ROOM0, DATA.rooms[1].id],
    facilityValues: {
      [NUM]: 22.5,
      [paramOfKind("select").id]: "Some option",
      [BOOL]: false,
      [RANGE]: { min: 30, max: 65 },
      [BT]: { value: true, text: "Method A" },
      [TEXT]: "free text",
    },
    roomValues: { [ROOM0]: { "DIM-001": 40, [NUM]: null } },
  });
}

const validInputs = () => ps.serializeInputs(filledState());
const errorsFor = (inputs) => {
  const r = ps.validateInputs(inputs, DATA);
  assert.equal(r.ok, false, "expected rejection");
  return r.errors.join("\n");
};

// ---------------------------------------------------------------- round trip

test("serialize → JSON → validate → resetState reproduces the same inputs", () => {
  const original = filledState();
  const wire = JSON.parse(JSON.stringify(ps.serializeInputs(original)));
  const r = ps.validateInputs(wire, DATA);
  assert.equal(r.ok, true, r.errors && r.errors.join("\n"));
  const target = makeState({ category: "sterile", facilityValues: { stale: 1 } });
  ps.resetState(target, r.inputs);
  assert.deepEqual(ps.serializeInputs(target), ps.serializeInputs(original));
  assert.equal(target.step, 1, "reopened project starts at step 1");
  assert.equal(target.facilityValues.stale, undefined, "old values are cleared");
});

test("serializeInputs omits UI-only state (step) and deep-copies values", () => {
  const s = filledState();
  const out = ps.serializeInputs(s);
  assert.equal("step" in out, false);
  out.selectedRooms.push("X");
  out.roomValues[ROOM0]["DIM-001"] = 1;
  assert.equal(s.selectedRooms.includes("X"), false);
  assert.equal(s.roomValues[ROOM0]["DIM-001"], 40);
});

test("resetState with no inputs restores the blank wizard", () => {
  const s = filledState();
  ps.resetState(s);
  assert.deepEqual(s, ps.defaultState());
});

test("resetState keeps the same state object (app holds a const reference)", () => {
  const s = filledState();
  const ref = s;
  ps.resetState(s, ps.validateInputs(validInputs(), DATA).inputs);
  assert.equal(s, ref);
});

test("validated inputs share no references with the raw payload", () => {
  const raw = validInputs();
  const r = ps.validateInputs(raw, DATA);
  assert.notEqual(r.inputs.roomValues, raw.roomValues);
  assert.notEqual(r.inputs.roomValues[ROOM0], raw.roomValues[ROOM0]);
  assert.notEqual(r.inputs.selectedRooms, raw.selectedRooms);
});

// ---------------------------------------------------------------- R6 rejections

test("rejects non-object payloads", () => {
  for (const bad of [null, undefined, 42, "x", [], [validInputs()]]) {
    assert.equal(ps.validateInputs(bad, DATA).ok, false, `accepted ${JSON.stringify(bad)}`);
  }
});

test("rejects unknown top-level keys", () => {
  assert.match(errorsFor({ ...validInputs(), isAdmin: true }), /isAdmin/);
  assert.match(errorsFor({ ...validInputs(), step: 4 }), /step/);
});

test("rejects __proto__ / constructor / prototype keys at any depth (as JSON.parse delivers them)", () => {
  const json = JSON.stringify(validInputs());
  const injections = [
    json.replace(/^\{/, '{"__proto__":{"polluted":true},'),
    json.replace('"facilityValues":{', '"facilityValues":{"constructor":1,'),
    json.replace(`"roomValues":{"${ROOM0}":{`, `"roomValues":{"${ROOM0}":{"__proto__":1,`),
    json.replace(`"${RANGE}":{`, `"${RANGE}":{"prototype":1,`),
  ];
  for (const bad of injections) {
    assert.notEqual(bad, json, "injection did not apply");
    assert.match(errorsFor(JSON.parse(bad)), /forbidden key/, bad.slice(0, 80));
  }
  assert.equal({}.polluted, undefined);
});

test("rejects unknown room ids and parameter ids", () => {
  assert.match(errorsFor({ ...validInputs(), selectedRooms: ["NOPE-99"] }), /NOPE-99/);
  assert.match(errorsFor({ ...validInputs(), facilityValues: { "FAKE-001": 1 } }), /FAKE-001/);
  assert.match(errorsFor({ ...validInputs(), roomValues: { "NOPE-99": {} } }), /NOPE-99/);
  assert.match(errorsFor({ ...validInputs(), roomValues: { [ROOM0]: { "FAKE-001": 1 } } }), /FAKE-001/);
});

test("rejects unknown category, dosage form, market, stage, scale", () => {
  assert.match(errorsFor({ ...validInputs(), category: "gas" }), /category/);
  assert.match(errorsFor({ ...validInputs(), specificForms: ["Implant"] }), /Implant/); // sterile form, not OSD
  assert.match(errorsFor({ ...validInputs(), targetMarkets: ["mars"] }), /mars/);
  assert.match(errorsFor({ ...validInputs(), devStage: "Factory" }), /devStage/);
  assert.match(errorsFor({ ...validInputs(), scaleSize: "Huge" }), /scaleSize/);
});

test("rejects duplicate entries in id lists", () => {
  assert.match(errorsFor({ ...validInputs(), selectedRooms: [ROOM0, ROOM0] }), /duplicate/);
  assert.match(errorsFor({ ...validInputs(), targetMarkets: ["us_fda", "us_fda"] }), /duplicate/);
});

test("rejects values whose shape does not match the parameter's input kind", () => {
  const bad = [
    [NUM, "12"],
    [NUM, { min: 1 }],
    [RANGE, 5],
    [RANGE, { min: 1, max: 2, extra: 3 }],
    [BOOL, "true"],
    [BT, { value: "yes" }],
    [BT, { value: true, text: 5 }],
  ];
  for (const [id, v] of bad) {
    const inputs = validInputs();
    inputs.facilityValues[id] = v;
    assert.match(errorsFor(inputs), new RegExp(id), `${id} = ${JSON.stringify(v)}`);
  }
});

test("rejects non-finite or out-of-range numbers", () => {
  for (const v of [Infinity, -Infinity, NaN, 1e12, -1e12]) {
    const inputs = validInputs();
    inputs.facilityValues[NUM] = v;
    assert.match(errorsFor(inputs), new RegExp(NUM), String(v));
  }
});

test("caps text lengths", () => {
  const inputs = validInputs();
  inputs.facilityValues[TEXT] = "x".repeat(ps.LIMITS.textMax + 1);
  assert.match(errorsFor(inputs), /too long/);
  assert.match(errorsFor({ ...validInputs(), batchSize: "x".repeat(ps.LIMITS.batchSizeMax + 1) }), /batchSize/);
});

test("allows null for any cleared parameter value", () => {
  const inputs = validInputs();
  for (const k of Object.keys(inputs.facilityValues)) inputs.facilityValues[k] = null;
  assert.equal(ps.validateInputs(inputs, DATA).ok, true);
});

// ---------------------------------------------------------------- project envelope

test("validateProject: name required, ≤120 chars; notes ≤2000; unknown keys; body ≤256 KB", () => {
  const ok = ps.validateProject({ name: "Plant A", notes: "", inputs: validInputs() }, DATA);
  assert.equal(ok.ok, true, ok.errors && ok.errors.join("\n"));
  assert.equal(ok.project.name, "Plant A");

  const fail = (p, re) => {
    const r = ps.validateProject(p, DATA);
    assert.equal(r.ok, false);
    assert.match(r.errors.join("\n"), re);
  };
  fail({ name: "   ", notes: "", inputs: validInputs() }, /name/);
  fail({ name: "x".repeat(121), notes: "", inputs: validInputs() }, /name/);
  fail({ name: "ok", notes: "x".repeat(2001), inputs: validInputs() }, /notes/);
  fail({ name: "ok", notes: "", inputs: validInputs(), owner_id: "someone" }, /owner_id/);
  fail({ name: "ok", notes: "", inputs: { ...validInputs(), category: "gas" } }, /category/);

  // Every field individually within limits, but the whole body over 256 KB.
  const textParams = DATA.parameters.filter((p) => ps.resolveInputKind(p) === "text").map((p) => p.id);
  const huge = validInputs();
  huge.roomValues = Object.fromEntries(DATA.rooms.map((r) => [r.id, Object.fromEntries(textParams.map((id) => [id, "y".repeat(ps.LIMITS.textMax)]))]));
  assert.equal(ps.validateInputs(huge, DATA).ok, true, "precondition: fields individually valid");
  fail({ name: "ok", notes: "", inputs: huge }, /256/);
});

test("validateProject trims the name and keeps an <img onerror> name as plain data", () => {
  const r = ps.validateProject({ name: '  <img src=x onerror="alert(1)">  ', notes: "", inputs: validInputs() }, DATA);
  assert.equal(r.ok, true);
  assert.equal(r.project.name, '<img src=x onerror="alert(1)">');
});

// ---------------------------------------------------------------- unsaved changes

test("fingerprint: equal for the same saveable content, whatever the key order or step", () => {
  const a = filledState();
  const b = JSON.parse(JSON.stringify(a));
  b.step = 1;
  b.facilityValues = Object.fromEntries(Object.entries(b.facilityValues).reverse());
  assert.equal(ps.fingerprint({ name: "Plant", notes: "", state: a }), ps.fingerprint({ name: "Plant", notes: "", state: b }));
});

test("fingerprint: changes when any input, the name or the notes change", () => {
  const base = ps.fingerprint({ name: "Plant", notes: "n", state: filledState() });
  const s = filledState();
  s.roomValues[ROOM0]["DIM-001"] = 41;
  assert.notEqual(ps.fingerprint({ name: "Plant", notes: "n", state: s }), base);
  assert.notEqual(ps.fingerprint({ name: "Plant 2", notes: "n", state: filledState() }), base);
  assert.notEqual(ps.fingerprint({ name: "Plant", notes: "m", state: filledState() }), base);
});

test("fingerprint: surrounding spaces in the name don't count as a change (save trims them)", () => {
  assert.equal(ps.fingerprint({ name: "  Plant ", notes: "", state: filledState() }), ps.fingerprint({ name: "Plant", notes: "", state: filledState() }));
});

// ---------------------------------------------------------------- category switching

test("switchCategory sets aside the old category's choices and restores them on return", () => {
  const s = filledState(); // osd_rnd_pilot, forms + devStage + rooms chosen
  const memory = {};
  const before = { specificForms: [...s.specificForms], devStage: s.devStage, selectedRooms: [...s.selectedRooms] };
  ps.switchCategory(s, "sterile", memory);
  assert.equal(s.category, "sterile");
  assert.deepEqual([s.specificForms, s.devStage, s.selectedRooms], [[], null, []]);
  s.specificForms.push("Implant");
  ps.switchCategory(s, "ext_prep", memory);
  ps.switchCategory(s, "osd_rnd_pilot", memory);
  assert.deepEqual({ specificForms: s.specificForms, devStage: s.devStage, selectedRooms: s.selectedRooms }, before);
  ps.switchCategory(s, "sterile", memory);
  assert.deepEqual(s.specificForms, ["Implant"]);
});

test("switchCategory to the current category changes nothing; restored lists are copies", () => {
  const s = filledState();
  const memory = {};
  const forms = [...s.specificForms];
  ps.switchCategory(s, s.category, memory);
  assert.deepEqual(s.specificForms, forms);
  ps.switchCategory(s, "sterile", memory);
  ps.switchCategory(s, "osd_rnd_pilot", memory);
  s.specificForms.push("Capsule (x)");
  ps.switchCategory(s, "sterile", memory);
  ps.switchCategory(s, "osd_rnd_pilot", memory);
  assert.ok(s.specificForms.includes("Capsule (x)"), "latest choices are what gets remembered");
});

// ---------------------------------------------------------------- primary authority (Milestone 3)

test("primaryAuthority is a saved input and round-trips", () => {
  const s = filledState();
  s.primaryAuthority = "us_fda";
  const r = ps.validateInputs(JSON.parse(JSON.stringify(ps.serializeInputs(s))), DATA);
  assert.equal(r.ok, true, r.errors && r.errors.join("\n"));
  assert.equal(r.inputs.primaryAuthority, "us_fda");
  assert.equal(ps.defaultState().primaryAuthority, "schedule_m");
});

test("primaryAuthority must be a known, covered authority that is one of the target markets", () => {
  assert.match(errorsFor({ ...validInputs(), primaryAuthority: "mars" }), /primaryAuthority/);
  assert.match(errorsFor({ ...validInputs(), primaryAuthority: "uk_mhra" }), /primaryAuthority/);
  assert.match(errorsFor({ ...validInputs(), primaryAuthority: "eu_gmp" }), /primaryAuthority/); // not a target market here
});

test("older saves without primaryAuthority default to the first covered target market", () => {
  const raw = validInputs();
  delete raw.primaryAuthority;
  assert.equal(ps.validateInputs({ ...raw, targetMarkets: ["us_fda", "schedule_m"] }, DATA).inputs.primaryAuthority, "us_fda");
  assert.equal(ps.validateInputs({ ...raw, targetMarkets: [] }, DATA).inputs.primaryAuthority, null);
});

test("authorities without data are dropped from older saves, never rejected; unknown ones still are", () => {
  const raw = validInputs();
  delete raw.primaryAuthority;
  const r = ps.validateInputs({ ...raw, targetMarkets: ["uk_mhra", "schedule_m", "sfda"] }, DATA);
  assert.equal(r.ok, true, r.errors && r.errors.join("\n"));
  assert.deepEqual(r.inputs.targetMarkets, ["schedule_m"]);
  assert.equal(r.inputs.primaryAuthority, "schedule_m");
  assert.match(errorsFor({ ...validInputs(), targetMarkets: ["mars"] }), /mars/);
});

test("ensurePrimary keeps a still-selected choice, picks the only market, otherwise asks", () => {
  const s = filledState(); // markets schedule_m + us_fda, primary schedule_m
  ps.ensurePrimary(s);
  assert.equal(s.primaryAuthority, "schedule_m");
  s.targetMarkets = ["us_fda", "eu_gmp"];
  ps.ensurePrimary(s);
  assert.equal(s.primaryAuthority, null, "primary removed and several remain: the planner chooses");
  s.targetMarkets = ["eu_gmp"];
  ps.ensurePrimary(s);
  assert.equal(s.primaryAuthority, "eu_gmp", "a single market is the obvious primary");
});

test("an explicit null primary (planner hasn't chosen yet) is kept; only a missing key gets the default", () => {
  const r = ps.validateInputs({ ...validInputs(), targetMarkets: ["schedule_m", "us_fda"], primaryAuthority: null }, DATA);
  assert.equal(r.ok, true, r.errors && r.errors.join("\n"));
  assert.equal(r.inputs.primaryAuthority, null);
});

test("an older save whose markets all lack data loads with no markets and no primary", () => {
  const raw = validInputs();
  delete raw.primaryAuthority;
  const r = ps.validateInputs({ ...raw, targetMarkets: ["uk_mhra", "sahpra"] }, DATA);
  assert.equal(r.ok, true, r.errors && r.errors.join("\n"));
  assert.deepEqual([r.inputs.targetMarkets, r.inputs.primaryAuthority], [[], null]);
});

test("non-string market entries are errors, never silently dropped; long bad values are not echoed in full", () => {
  assert.match(errorsFor({ ...validInputs(), targetMarkets: [["uk_mhra"], "schedule_m"] }), /targetMarkets/);
  const msg = errorsFor({ ...validInputs(), primaryAuthority: "x".repeat(500) });
  assert.ok(msg.length < 200, `error message is ${msg.length} chars`);
});

// PDF intake needs the same select options as the Step 3 form, so they live here.
test("optionsFor: overrides first, otherwise unit_options split on ' / '", () => {
  assert.deepEqual(ps.optionsFor(DATA.paramById["HVAC-001"]), ["Unclassified/CNC", "Grade D (ISO 8)", "Grade C (ISO 7)", "Grade B", "Grade A (ISO 5)"]);
  assert.deepEqual(ps.optionsFor(DATA.paramById["HVAC-007"]), ["G4", "G4+F8", "G4+F8+H13", "H14"]);
  assert.deepEqual(ps.optionsFor(DATA.paramById["UTIL-001"]), ["Class 1", "Class 1.2.1", "Class 2"]);
  assert.deepEqual(ps.optionsFor(DATA.paramById["SHE-004"]), ["OEB 1", "OEB 2", "OEB 3", "OEB 4", "OEB 5"]);
});
