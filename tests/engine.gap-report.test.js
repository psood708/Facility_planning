// Milestone 4 — cross-authority gap report, engine side:
//  - the report compares every covered authority, once per dataset (EU-GMP and
//    PIC/S share identical data, so they are one combined authority);
//  - every gap has a concrete suggested change (an action and a target), never
//    a vague "review this".
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadData, makeState, engine } = require("./helpers.js");
const ps = require("../project-state.js");

const DATA = loadData();

test("reportAuthorities: the six covered authorities, EU-GMP and PIC/S combined", () => {
  const r = engine.reportAuthorities(DATA);
  assert.deepEqual(r.map((a) => a.key), ["schedule_m", "us_fda", "eu_gmp", "who_gmp", "china_nmpa", "japan_pmda"]);
  const eu = r.find((a) => a.key === "eu_gmp");
  assert.deepEqual(eu.keys, ["eu_gmp", "pics"]);
  assert.equal(eu.label, "EU-GMP / PIC/S");
  for (const a of r) assert.equal(DATA.authorityByKey[a.key].covered, true);
});

test("reportKeyFor / reportLabel map any chosen market to its report authority", () => {
  assert.equal(engine.reportKeyFor(DATA, "pics"), "eu_gmp");
  assert.equal(engine.reportKeyFor(DATA, "eu_gmp"), "eu_gmp");
  assert.equal(engine.reportKeyFor(DATA, "us_fda"), "us_fda");
  assert.equal(engine.reportKeyFor(DATA, "uk_mhra"), null, "no data, not in the report");
  assert.equal(engine.reportLabel(DATA, "pics"), "EU-GMP / PIC/S");
  assert.equal(engine.reportLabel(DATA, "us_fda"), "US FDA");
});

test("reportState evaluates every covered authority whatever was ticked, without changing the project", () => {
  const s = makeState({ targetMarkets: ["schedule_m"] });
  const r = engine.reportState(DATA, s);
  assert.deepEqual(r.targetMarkets, engine.reportAuthorities(DATA).map((a) => a.key));
  assert.deepEqual(s.targetMarkets, ["schedule_m"], "the project's own markets are untouched");
});

// Every parameter, every category, extreme values (too low, negative, huge),
// all covered authorities: each gap must say what to change and to what.
test("every gap has a concrete suggested change", () => {
  const ACTION = /^(Increase|Decrease|Adjust|Upgrade|Add|Set|Change)\b/;
  let seen = 0;
  for (const cat of ["ext_prep", "osd_production", "osd_rnd_pilot", "sterile"]) {
    for (const v of [0, -50, 1e6]) {
      const rooms = DATA.rooms.filter((r) => r.applies_to[cat]).map((r) => r.id);
      const params = DATA.parameters.filter((p) => p.applicability[cat]);
      const value = (p) => {
        const k = ps.resolveInputKind(p);
        return k === "number" ? v : k === "number-range" ? { min: v, max: v } : k === "boolean" ? false : k === "boolean-text" ? { value: false, text: "" } : k === "select" ? "zzz" : "x";
      };
      const fv = Object.fromEntries(params.map((p) => [p.id, value(p)]));
      const rv = Object.fromEntries(rooms.map((r) => [r, { ...fv, "DIM-001": v }]));
      const s = engine.reportState(DATA, makeState({ category: cat, specificForms: ["x"], devStage: "Pilot Plant", selectedRooms: rooms, facilityValues: fv, roomValues: rv }));
      for (const r of engine.evaluateAll(DATA, s).recommendations) {
        seen += 1;
        assert.match(r.text, ACTION, `${r.id}: ${r.text}`);
        assert.ok(r.text.length > 25, `${r.id}: "${r.text}" is too thin to act on`);
        assert.ok(["mandatory", "recommended", "unclassified"].includes(r.obligation), `${r.id}: obligation ${r.obligation}`);
      }
    }
  }
  assert.ok(seen > 1000, `only ${seen} gaps exercised`);
});

test("suggested changes name the combined EU authority the way the report does", () => {
  const s = engine.reportState(DATA, makeState({ category: "sterile", specificForms: ["x"], selectedRooms: ["Z-29"], roomValues: { "Z-29": { "DIM-001": 120, "HVAC-001": "Grade B", "HVAC-002": { min: 19, max: 24 } } } }));
  const temp = engine.evaluateAll(DATA, s).recommendations.find((r) => /Temperature/.test(r.text));
  assert.ok(temp, "a temperature gap");
  assert.match(temp.text, /EU-GMP \/ PIC\/S/);
});
