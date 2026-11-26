// PDF intake: turning a read document into proposed values (candidates), then
// into validated wizard inputs. Documents are built from synthetic text items
// laid out like real ones (see doc-lines.test.js): a printed results report
// with a long ROOM | PARAMETER | ENTERED table, a feature checklist, "Param
// (Room): value" lines and recommendation sentences; and a designer's wide
// room-per-row table with units in the headers.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadData, makeState } = require("./helpers.js");
const ProjectState = require("../project-state.js");
const DocLines = require("../doc-lines.js");
const IntakeVocab = require("../intake-vocab.js");
const IntakeMatch = require("../intake-match.js");

const DATA = loadData();
const it = (str, x, y, opts = {}) => ({ str, x, y, w: opts.w ?? str.length * 5.2, h: opts.h ?? 10, rot: opts.rot ?? 0, conf: opts.conf ?? 1 });
const page = (items, index = 1, source = "text") => ({ index, source, lines: DocLines.toLines(items) });
const textPage = (lines, index = 1) => page(lines.map((t, i) => it(t, 40, 40 + i * 14, { w: Math.min(500, t.length * 5.2) })), index);
const doc = (...pages) => ({ name: "test.pdf", pages });
const run = (d) => IntakeMatch.runAll(d, { DATA });
const find = (cands, pred) => cands.find(pred) || null;
const param = (cands, roomId, paramId) => find(cands, (c) => c.target.kind === "param" && c.target.paramId === paramId && (roomId === null ? c.target.scope === "facility" : c.target.roomId === roomId));

// A printed results report: long table with wrapped cells (as in a real export).
function reportPage() {
  return page([
    it("ROOM", 72, 45), it("PARAMETER", 229, 45), it("ENTERED", 306, 45), it("SEVERITY", 398, 45), it("STATUS", 463, 45),
    it("Facility", 72, 71), it("Water TOC", 229, 71), it("500", 306, 71), it("Partial", 402, 71),
    it("Facility", 72, 120), it("Personnel", 229, 120), it("Flow Type", 229, 135), it("Unidirectional", 306, 120), it("Partial", 402, 120),
    it("Facility", 72, 170), it("Material Flow", 229, 170), it("Segregation", 229, 185), it("Dedicated de-", 306, 170), it("boxing room", 306, 185),
    it("Inward Material / Goods", 72, 230), it("Receiving Bay", 72, 245), it("Room Clear", 229, 230), it("Height", 229, 245), it("2.75", 306, 230), it("Significant", 402, 230),
    it("Inward Material / Goods", 72, 290), it("Receiving Bay", 72, 305), it("Temperature", 229, 290), it("?–25", 306, 290), it("Partial", 402, 290),
    it("Inward Material / Goods", 72, 350), it("Receiving Bay", 72, 365), it("Air Changes", 229, 350), it("per Hour", 229, 365), it("(ACH)", 229, 380), it("—", 306, 350),
    it("In-Process Hold / Bulk Hold", 72, 420), it("Cleanroom", 229, 420), it("Grade / ISO", 229, 435), it("Class", 229, 450), it("Grade C (ISO 7)", 306, 420),
    it("In-Process Hold / Bulk Hold", 72, 490), it("HEPA Filter", 229, 490), it("Efficiency", 229, 505), it("0.3", 306, 490),
  ]);
}

function featurePage() {
  return page([
    it("ROOM", 72, 45), it("FEATURE", 117, 45), it("ENTERED", 333, 45), it("SEVERITY", 388, 45), it("STATUS", 444, 45),
    it("Facility", 72, 71), it("Emergency Shower / Eyewash Provision", 117, 71), it("Yes", 333, 71), it("Critical", 392, 71),
    it("Facility", 72, 113), it("Grey Water (Process Effluent) Treatment", 117, 113), it("—", 333, 113), it("Critical", 392, 113),
    it("Facility", 72, 141), it("Black Water (Sewage) Treatment", 117, 141), it("No", 333, 141), it("Aligned", 392, 141),
  ], 2);
}

// ---------------------------------------------------------------- vocabulary

test("vocabulary: every target exists in the dataset or the form (no typos)", () => {
  const grades = ProjectState.optionsFor(DATA.paramById["HVAC-001"]);
  for (const [, option] of IntakeVocab.GRADES) assert.ok(grades.includes(option), option);
  for (const key of Object.keys(IntakeVocab.MARKET_WORDS)) assert.ok(DATA.authorityByKey[key], key);
  for (const [, id] of IntakeVocab.PARAM_HEADERS) assert.ok(DATA.paramById[id], id);
  for (const id of Object.values(IntakeVocab.ROOM_EXTRAS)) assert.ok(DATA.roomById[id], id);
  for (const key of Object.keys(IntakeVocab.CATEGORY_WORDS)) assert.ok(ProjectState.SPECIFIC_FORMS[key], key);
  for (const form of Object.values(IntakeVocab.FORM_WORDS)) assert.ok(Object.values(ProjectState.SPECIFIC_FORMS).flat().includes(form), form);
});

// ---------------------------------------------------------------- tables

test("long table: room + parameter + entered value become room and facility candidates", () => {
  const c = run(doc(reportPage()));
  assert.deepEqual(param(c, null, "WTR-003").value, 500);
  assert.equal(param(c, null, "FLOW-004").value, "Unidirectional");
  assert.equal(param(c, null, "FLOW-005").value, "Dedicated de-boxing room", "wrapped value rejoined and matched to the option");
  const h = param(c, "Z-01", "DIM-004");
  assert.equal(h.value, 2.75);
  assert.equal(h.confidence, "high");
  assert.equal(h.source.page, 1);
  assert.match(h.reason, /table/i);
  assert.deepEqual(param(c, "Z-01", "HVAC-002").value, { min: null, max: 25 }, "'?–25' is an open-ended range");
  assert.equal(param(c, "Z-01", "HVAC-004"), null, "'—' is no value");
  const holdId = DATA.rooms.find((r) => /In-Process Hold/.test(r.name)).id;
  assert.equal(param(c, holdId, "HVAC-001").value, "Grade C (ISO 7)");
  assert.equal(param(c, holdId, "HVAC-008").value, 0.3);
  assert.ok(find(c, (x) => x.target.kind === "room" && x.target.roomId === "Z-01"), "the room itself is proposed");
});

test("feature table: yes/no features map to their parameters; '—' is skipped", () => {
  const c = run(doc(featurePage()));
  assert.equal(param(c, null, "SHE-006").value, true);
  assert.deepEqual(param(c, null, "WTR-007").value, { value: false });
  assert.equal(param(c, null, "WTR-006"), null);
});

test("wide table: one row per room, units in the headers, partial room names", () => {
  const p = page([
    it("Room", 40, 50), it("Area (sq ft)", 220, 50), it("Grade", 300, 50), it("Temp (°C)", 360, 50), it("RH (%)", 420, 50), it("ΔP (Pa)", 470, 50),
    it("Dispensing Booth", 40, 70), it("200", 220, 70), it("ISO 8", 300, 70), it("20-25", 360, 70), it("NMT 60", 420, 70), it("+15", 470, 70),
    it("Aseptic Filling", 40, 88), it("1,292", 220, 88), it("Grade B", 300, 88), it("22 ± 2", 360, 88), it("45-55", 420, 88), it("30", 470, 88),
  ]);
  const c = run(doc(p));
  const fill = "Z-29";
  const area = param(c, fill, "DIM-001");
  assert.equal(area.value, 120.03);
  assert.match(area.converted, /1,292 sq ft/);
  assert.equal(param(c, fill, "HVAC-001").value, "Grade B");
  assert.deepEqual(param(c, fill, "HVAC-002").value, { min: 20, max: 24 });
  assert.deepEqual(param(c, fill, "HVAC-003").value, { min: 45, max: 55 });
  assert.equal(param(c, fill, "HVAC-005").value, 30);
  assert.notEqual(param(c, fill, "DIM-001").confidence, "high", "a partial room name is never high confidence");
  const disp = param(c, "Z-07", "HVAC-001");
  assert.equal(disp.value, "Grade D (ISO 8)");
  assert.deepEqual(param(c, "Z-07", "HVAC-003").value, { min: null, max: 60 });
});

// ---------------------------------------------------------------- free text

test("'Param (Room): value' lines, including rooms with brackets in their names", () => {
  const c = run(doc(textPage([
    "Room Length (Inward Material / Goods Receiving Bay): 4.77",
    "Room Length (Quarantine Warehouse (RM & Packaging)): 10.47",
    "No authority prescribes room length directly",
  ])));
  assert.equal(param(c, "Z-01", "DIM-002").value, 4.77);
  assert.equal(param(c, "Z-03", "DIM-002").value, 10.47);
  assert.equal(param(c, "Z-01", "DIM-002").confidence, "high");
});

test("recommendation sentences give the current value, medium confidence, even across line breaks", () => {
  const c = run(doc(textPage([
    "Significant",
    "Increase Room Net Area in 'Aseptic Filling Suite (Vials/Ampoules/PFS/Cartridge)' from 93.7 m²",
    "to at least 150 m² to satisfy Schedule M: 150 m² minimum (Aseptic Filling Suite, SVP).",
    "Upgrade Cleanroom Grade in 'Dispensing / Weighing Room' from 'Grade C (ISO 7)' to 'Grade",
    "B' — this is this room's designated grade per the Room-Zone Master List.",
    "Adjust Temperature in 'Vial Capping / Crimping Room' from undefined–25 to fall within 18–22",
  ])));
  const area = param(c, "Z-29", "DIM-001");
  assert.equal(area.value, 93.7);
  assert.equal(area.confidence, "medium");
  assert.equal(param(c, "Z-07", "HVAC-001").value, "Grade C (ISO 7)", "the 'from' value, not the target");
  const cap = DATA.rooms.find((r) => /Vial Capping/.test(r.name)).id;
  assert.deepEqual(param(c, cap, "HVAC-002").value, { min: null, max: 25 });
});

test("numbers without a unit or header are never guessed (room numbers, revisions)", () => {
  const c = run(doc(textPage(["Room 12 Rev 3 Drawing A-101", "Page 4 of 53"])));
  assert.equal(c.filter((x) => x.target.kind === "param").length, 0);
});

// ---------------------------------------------------------------- facility level

test("markets: covered authorities are proposed; uncovered ones only noted", () => {
  const c = run(doc(textPage(["Which frameworks does this facility qualify under?", "India — Schedule M  Partial   EU-GMP  Partial   WHO GMP  Partial", "Also reviewed against UK MHRA guidance"])));
  const markets = c.filter((x) => x.target.kind === "market").map((x) => x.value).sort();
  assert.deepEqual(markets, ["eu_gmp", "schedule_m", "who_gmp"]);
  assert.ok(c.some((x) => x.target.kind === "note" && /UK MHRA/.test(x.display)), "uncovered authority is a note");
});

test("category: stated words win; otherwise inferred from the rooms found", () => {
  const stated = run(doc(textPage(["Sterile injectables facility — design basis"])));
  assert.equal(find(stated, (x) => x.target.kind === "category").value, "sterile");
  const inferred = run(doc(reportPage(), textPage(["Increase Room Net Area in 'Aseptic Filling Suite (Vials/Ampoules/PFS/Cartridge)' from 93.7 m² to 150 m²"], 2)));
  const cat = find(inferred, (x) => x.target.kind === "category");
  assert.equal(cat.value, "sterile");
  assert.equal(cat.confidence, "medium");
  assert.match(cat.reason, /room/i);
});

test("specific forms by name or short form", () => {
  const c = run(doc(textPage(["Products: sterile liquid in vials and PFS; ophthalmic drops"])));
  const forms = c.filter((x) => x.target.kind === "form").map((x) => x.value).sort();
  assert.deepEqual(forms, ["Ophthalmic Drops", "Sterile Liquid (PFS)", "Sterile Liquid (Vial)"]);
});

// ---------------------------------------------------------------- value parsing

test("parseValue: ranges, units, OCR noise and junk", () => {
  const P = (id, raw) => IntakeMatch.parseValue(DATA.paramById[id], raw);
  assert.deepEqual(P("HVAC-002", "22 ± 2 °C").value, { min: 20, max: 24 });
  assert.deepEqual(P("HVAC-002", "20–25").value, { min: 20, max: 25 });
  assert.deepEqual(P("HVAC-002", "68-77 °F").value, { min: 20, max: 25 });
  assert.match(P("HVAC-002", "68-77 °F").converted, /°F/);
  assert.deepEqual(P("HVAC-003", "NMT 60 %RH").value, { min: null, max: 60 });
  assert.deepEqual(P("HVAC-003", "≥ 30").value, { min: 30, max: null });
  assert.equal(IntakeMatch.parseValue(DATA.paramById["DIM-001"], "12O m2", null, { ocr: true }).value, 120, "OCR O→0 inside a number");
  assert.equal(P("DIM-001", "1 200 m²").value, 1200);
  assert.equal(P("HVAC-005", "1.5 mmWC").value, 14.71);
  assert.equal(P("HVAC-001", "Class 10,000").value, "Grade C (ISO 7)");
  assert.equal(P("HVAC-001", "ISO Class 5").value, "Grade A (ISO 5)");
  assert.equal(P("HVAC-007", "G4 + F8 + H13").value, "G4+F8+H13");
  assert.equal(P("SHE-006", "Provided").value, true);
  for (const junk of ["—", "-", "", "n/a", "?", "undefined", "NaN", "1e99"]) assert.equal(P("DIM-001", junk), null, junk);
  assert.equal(P("HVAC-001", "Grade Z"), null);
});

// ---------------------------------------------------------------- resolve + apply

test("resolve: agreeing values merge; disagreeing values become a conflict with no default", () => {
  const c = run(doc(textPage(["Room Length (Inward Material / Goods Receiving Bay): 4.77"]), textPage(["Room Length (Inward Material / Goods Receiving Bay): 4.77", "Room Length (Approved Raw Material Store): 10.47"], 2), textPage(["Room Length (Approved Raw Material Store): 9"], 3)));
  const items = IntakeMatch.resolve(c, makeState({ category: "sterile", selectedRooms: [] }), DATA);
  const z01 = items.find((i) => i.key === "param:room:Z-01:DIM-002");
  assert.equal(z01.conflict, false);
  assert.equal(z01.sources.length, 2);
  assert.equal(z01.checked, true);
  const z04 = items.find((i) => i.key === "param:room:Z-04:DIM-002");
  assert.equal(z04.conflict, true);
  assert.deepEqual(z04.options.map((o) => o.value).sort(), [10.47, 9]);
  assert.equal(z04.checked, false);
});

test("resolve: a value that would replace one already entered says so; an equal one is marked same", () => {
  const c = run(doc(textPage(["Room Length (Inward Material / Goods Receiving Bay): 4.77", "Room Length (Approved Raw Material Store): 10.47"])));
  const st = makeState({ category: "sterile", selectedRooms: ["Z-01", "Z-04"], roomValues: { "Z-01": { "DIM-002": 4 }, "Z-04": { "DIM-002": 10.47 } } });
  const items = IntakeMatch.resolve(c, st, DATA);
  assert.equal(items.find((i) => i.key === "param:room:Z-01:DIM-002").replaces, "4 m");
  assert.equal(items.find((i) => i.key === "param:room:Z-04:DIM-002").same, true);
});

test("buildInputs: fills exactly the accepted values and passes validateInputs", () => {
  const c = run(doc(reportPage(), featurePage()));
  const st = makeState({ category: "sterile", selectedRooms: [], targetMarkets: ["schedule_m"], primaryAuthority: "schedule_m" });
  const items = IntakeMatch.resolve(c, st, DATA).filter((i) => !i.conflict);
  const accepted = items.filter((i) => i.key !== "param:room:Z-01:HVAC-002");
  const r = IntakeMatch.buildInputs(st, accepted, DATA);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.inputs.roomValues["Z-01"]["DIM-004"], 2.75);
  assert.equal(r.inputs.roomValues["Z-01"]["HVAC-002"], undefined, "unticked values are not filled");
  assert.ok(r.inputs.selectedRooms.includes("Z-01"));
  assert.equal(r.inputs.facilityValues["SHE-006"], true);
  assert.equal(r.inputs.facilityValues["WTR-003"], 500);
  assert.deepEqual(st.selectedRooms, [], "the state passed in is not changed");
});

test("buildInputs: a new category sets aside forms and rooms like the Step 1 switch; primary authority stays consistent", () => {
  const st = makeState({ category: "osd_production", specificForms: ["Capsule"], selectedRooms: [], targetMarkets: ["schedule_m"], primaryAuthority: "schedule_m" });
  const accepted = [
    { target: { kind: "category" }, value: "sterile" },
    { target: { kind: "form" }, value: "Sterile Liquid (Vial)" },
    { target: { kind: "market" }, value: "us_fda" },
  ];
  const memory = {};
  const r = IntakeMatch.buildInputs(st, accepted, DATA, memory);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.inputs.category, "sterile");
  assert.deepEqual(r.inputs.specificForms, ["Sterile Liquid (Vial)"]);
  assert.deepEqual(r.memory.osd_production.specificForms, ["Capsule"], "the old category's forms are kept for switching back");
  assert.deepEqual(r.inputs.targetMarkets.sort(), ["schedule_m", "us_fda"]);
  assert.equal(r.inputs.primaryAuthority, "schedule_m");
});

test("buildInputs rejects junk without touching anything", () => {
  const st = makeState({});
  const before = JSON.stringify(st);
  const r = IntakeMatch.buildInputs(st, [{ target: { kind: "param", scope: "room", roomId: "Z-01", paramId: "DIM-001" }, value: Number.NaN }], DATA);
  assert.equal(r.ok, false);
  const r2 = IntakeMatch.buildInputs(st, [{ target: { kind: "param", scope: "room", roomId: "__proto__", paramId: "DIM-001" }, value: 5 }], DATA);
  assert.equal(r2.ok, false);
  assert.equal(JSON.stringify(st), before);
  assert.equal({}.polluted, undefined);
});

test("document text can't reach object prototypes or crash the matcher", () => {
  const c = run(doc(textPage(["__proto__ (constructor): 5", "constructor: toString", "Room Length (__proto__): 4"])));
  assert.ok(Array.isArray(c));
  assert.equal(({}).constructor, Object);
});

test("extractors: the rule extractor is registered and every candidate has the contract's shape", () => {
  assert.deepEqual(IntakeMatch.extractors.map((e) => e.id), ["rules"]);
  for (const x of run(doc(reportPage(), featurePage()))) {
    assert.ok(["category", "form", "devStage", "market", "room", "param", "note"].includes(x.target.kind), x.target.kind);
    assert.ok(["high", "medium", "low"].includes(x.confidence));
    assert.ok(typeof x.display === "string" && x.display.length);
    assert.ok(x.source && Number.isInteger(x.source.page) && typeof x.source.text === "string" && x.source.text.length <= 200);
  }
});

// ---------------------------------------------------------------- review follow-ups

test("buildInputs reports exactly what it applied: rooms outside the category and their values are left out", () => {
  const st = makeState({ category: "osd_production", specificForms: [], selectedRooms: [], targetMarkets: ["schedule_m"], primaryAuthority: "schedule_m" });
  const accepted = [
    { key: "param:room:Z-07:DIM-001", target: { kind: "param", scope: "room", roomId: "Z-07", paramId: "DIM-001" }, value: 18 }, // used in OSD
    { key: "param:room:Z-29:DIM-001", target: { kind: "param", scope: "room", roomId: "Z-29", paramId: "DIM-001" }, value: 120 }, // sterile only
    { key: "room:Z-29", target: { kind: "room", roomId: "Z-29" }, value: "Z-29" },
    { key: "form:Implant", target: { kind: "form" }, value: "Implant" }, // a sterile form
  ];
  const r = IntakeMatch.buildInputs(st, accepted, DATA);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.applied, ["param:room:Z-07:DIM-001"]);
  assert.deepEqual(r.skipped.sort(), ["form:Implant", "param:room:Z-29:DIM-001", "room:Z-29"]);
});

test("buildInputs never changes the category memory it was given; the new memory comes back on success", () => {
  const st = makeState({ category: "osd_production", specificForms: ["Capsule"], selectedRooms: [], targetMarkets: ["schedule_m"], primaryAuthority: "schedule_m" });
  const memory = {};
  const bad = IntakeMatch.buildInputs(st, [{ target: { kind: "category" }, value: "sterile" }, { target: { kind: "param", scope: "room", roomId: "Z-29", paramId: "DIM-001" }, value: Number.NaN }], DATA, memory);
  assert.equal(bad.ok, false);
  assert.deepEqual(memory, {}, "failed apply leaves memory alone");
  const good = IntakeMatch.buildInputs(st, [{ target: { kind: "category" }, value: "sterile" }], DATA, memory);
  assert.deepEqual(memory, {});
  assert.deepEqual(good.memory.osd_production.specificForms, ["Capsule"]);
});

test("numbers: Indian lakh grouping reads; OCR digit fixes apply to scanned text only", () => {
  const P = (id, raw, opts) => IntakeMatch.parseValue(DATA.paramById[id], raw, null, opts);
  assert.equal(P("DIM-001", "1,00,000 m²").value, 100000);
  assert.equal(P("DIM-001", "12,50,000").value, 1250000);
  assert.equal(P("DIM-001", "12O m2", { ocr: true }).value, 120);
  assert.equal(P("DIM-001", "12O m2"), null, "a typed PDF's 'O' is a letter, not a zero");
});
