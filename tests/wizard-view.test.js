// Wizard presentation helpers (projects-view.js → ProjectsView.wizard): step validation issues, the
// inline error summary, the stepper states, field ids and the room filter.
// They take h() as a parameter, so these render to plain objects.
const test = require("node:test");
const assert = require("node:assert/strict");
const wv = require("../projects-view.js").wizard;
const { makeState } = require("./helpers.js");

function h(tag, attrs = {}, children = []) {
  const kids = (Array.isArray(children) ? children : [children]).filter((c) => c !== null && c !== undefined && c !== false);
  return { tag, attrs: attrs || {}, children: kids.map((c) => (typeof c === "number" ? String(c) : c)) };
}
const text = (n) => (n === null || n === undefined ? "" : typeof n === "string" ? n : n.children.map(text).join(""));
const all = (n, pred, out = []) => {
  if (!n || typeof n === "string") return out;
  if (pred(n)) out.push(n);
  n.children.forEach((c) => all(c, pred, out));
  return out;
};

// ---------------------------------------------------------------- step issues

test("stepIssues: step 1 with nothing chosen asks for a category only (forms appear after it)", () => {
  const issues = wv.stepIssues(1, makeState({ category: null }));
  assert.deepEqual(issues.map((i) => i.field), ["category"]);
  assert.match(issues[0].message, /dosage form category/i);
});

test("stepIssues: step 1 lists every problem in page order", () => {
  const issues = wv.stepIssues(1, makeState({ category: "osd_rnd_pilot", devStage: null, specificForms: [], targetMarkets: [] }));
  assert.deepEqual(issues.map((i) => i.field), ["devStage", "specificForms", "targetMarkets"]);
  issues.forEach((i) => assert.ok(i.message.length > 10, "each issue names what to fix"));
});

test("stepIssues: development stage is only required for R&D / pilot", () => {
  const ok = makeState({ category: "sterile", devStage: null, specificForms: ["Implant"], targetMarkets: ["schedule_m"] });
  assert.deepEqual(wv.stepIssues(1, ok), []);
});

test("stepIssues: step 2 needs a room; steps 3 and 4 never block", () => {
  assert.deepEqual(wv.stepIssues(2, makeState({ selectedRooms: [] })).map((i) => i.field), ["selectedRooms"]);
  assert.deepEqual(wv.stepIssues(2, makeState({ selectedRooms: ["Z-01"] })), []);
  assert.deepEqual(wv.stepIssues(3, makeState()), []);
  assert.deepEqual(wv.stepIssues(4, makeState()), []);
});

// ---------------------------------------------------------------- error summary

test("errorSummaryTitle counts problems in words people read", () => {
  assert.equal(wv.errorSummaryTitle(1), "There is 1 problem to fix before you continue");
  assert.equal(wv.errorSummaryTitle(3), "There are 3 problems to fix before you continue");
});

test("errorSummary: an alert listing each problem as a control that jumps to its field", () => {
  const picked = [];
  const issues = wv.stepIssues(1, makeState({ category: "osd_rnd_pilot", specificForms: [], targetMarkets: [] }));
  const n = wv.errorSummary(h, issues, { onSelect: (field) => picked.push(field), idPrefix: "s1" });
  assert.equal(n.attrs.role, "alert");
  assert.equal(n.attrs.tabindex, "-1", "focusable so the Next button can move focus to it");
  assert.equal(n.attrs["aria-labelledby"], "s1-error-title");
  assert.match(text(n), /There are 3 problems/);
  const buttons = all(n, (x) => x.tag === "button");
  assert.equal(buttons.length, 3);
  buttons.forEach((b) => assert.equal(b.attrs.type, "button"));
  assert.match(text(buttons[1]), /specific dosage form/i);
  buttons[1].attrs.onclick({ preventDefault() {} });
  assert.deepEqual(picked, ["specificForms"]);
});

test("errorSummary: nothing to show when there are no issues", () => {
  assert.equal(wv.errorSummary(h, [], { onSelect() {} }), null);
});

test("fieldError: inline message with a stable id for aria-describedby", () => {
  const n = wv.fieldError(h, { field: "targetMarkets", message: "Select at least one target market." });
  assert.equal(n.attrs.id, "error-targetMarkets");
  assert.match(text(n), /Error:/, "screen readers hear that it is an error, not just red text");
  assert.match(text(n), /Select at least one target market/);
});

// ---------------------------------------------------------------- stepper

test("stepperStates: completed / current / upcoming", () => {
  assert.deepEqual(wv.stepperStates(1), ["current", "upcoming", "upcoming", "upcoming"]);
  assert.deepEqual(wv.stepperStates(3), ["done", "done", "current", "upcoming"]);
});

test("stepState labels and step titles are text, not colour", () => {
  assert.equal(wv.stepStateLabel("done"), "completed");
  assert.equal(wv.stepStateLabel("current"), "current step");
  assert.equal(wv.stepStateLabel("upcoming"), "not started");
  assert.equal(wv.stepAnnouncement(2), "Step 2 of 4: Rooms & zones");
  assert.equal(wv.nextLabel(1), "Next: Rooms & zones");
  assert.equal(wv.nextLabel(3), "Next: Results");
});

// ---------------------------------------------------------------- fields

test("fieldId: unique, valid ids per scope and parameter", () => {
  assert.equal(wv.fieldId("facility", "HVAC-001"), "f-facility-HVAC-001");
  assert.equal(wv.fieldId("Z-29", "DIM-001"), "f-Z-29-DIM-001");
  assert.match(wv.fieldId("a b/c", "x.y"), /^[A-Za-z][A-Za-z0-9_-]*$/);
  assert.notEqual(wv.fieldId("Z-29", "DIM-001"), wv.fieldId("Z-30", "DIM-001"));
});

test("describedBy joins present ids, or gives null when there are none", () => {
  assert.equal(wv.describedBy("a", null, "", "b"), "a b");
  assert.equal(wv.describedBy(null, undefined), null);
});

// ---------------------------------------------------------------- rooms

const ROOMS = [
  { id: "Z-01", name: "Goods Receiving Bay", process_stage: "Receiving", typical_grade: "Unclassified/Controlled" },
  { id: "Z-10", name: "Dispensing Booth", process_stage: "Dispensing", typical_grade: "Grade D (ISO 8)" },
  { id: "Z-02", name: "Quarantine Store", process_stage: "Receiving", typical_grade: "Controlled" },
  { id: "Z-29", name: "Aseptic Filling", process_stage: "Filling", typical_grade: "Grade A (ISO 5)" },
];

test("groupByStage keeps the data's stage order and room order", () => {
  const g = wv.groupByStage(ROOMS);
  assert.deepEqual(g.map((x) => x.stage), ["Receiving", "Dispensing", "Filling"]);
  assert.deepEqual(g[0].rooms.map((r) => r.id), ["Z-01", "Z-02"]);
});

test("roomMatches: case-insensitive on name, stage, grade and id; blank matches all", () => {
  const ids = (q) => ROOMS.filter((r) => wv.roomMatches(r, q)).map((r) => r.id);
  assert.deepEqual(ids(""), ["Z-01", "Z-10", "Z-02", "Z-29"]);
  assert.deepEqual(ids("  "), ["Z-01", "Z-10", "Z-02", "Z-29"]);
  assert.deepEqual(ids("receiv"), ["Z-01", "Z-02"]);
  assert.deepEqual(ids("iso 5"), ["Z-29"]);
  assert.deepEqual(ids("grade"), ["Z-10", "Z-29"]);
  assert.deepEqual(ids("z-10"), ["Z-10"]);
  assert.deepEqual(ids("aseptic fill"), ["Z-29"], "all words must match");
});

test("selection and filter texts", () => {
  assert.equal(wv.selectionText(0, 36), "0 of 36 rooms selected");
  assert.equal(wv.selectionText(1, 36), "1 of 36 rooms selected");
  assert.equal(wv.filterText(4, 36), "Showing 4 of 36 rooms");
  assert.equal(wv.filterText(0, 36), "No rooms match this filter");
});

// ---------------------------------------------------------------- primary authority (Milestone 3)

const AUTHS = [
  { key: "schedule_m", label: "India — Schedule M", covered: true },
  { key: "us_fda", label: "US FDA", covered: true },
  { key: "uk_mhra", label: "UK MHRA", covered: false },
];

test("stepIssues: with markets chosen, step 1 needs a primary authority among them", () => {
  const base = { category: "sterile", specificForms: ["Implant"], targetMarkets: ["schedule_m", "us_fda"] };
  const missing = wv.stepIssues(1, makeState({ ...base, primaryAuthority: null }));
  assert.deepEqual(missing.map((i) => i.field), ["primaryAuthority"]);
  assert.match(missing[0].message, /primary authority/i);
  assert.deepEqual(wv.stepIssues(1, makeState({ ...base, primaryAuthority: "eu_gmp" })).map((i) => i.field), ["primaryAuthority"]);
  assert.deepEqual(wv.stepIssues(1, makeState({ ...base, primaryAuthority: "us_fda" })), []);
  assert.deepEqual(wv.stepIssues(1, makeState({ ...base, targetMarkets: [], primaryAuthority: null })).map((i) => i.field), ["targetMarkets"]);
});

test("marketChoices: authorities without data are listed but disabled with 'No data yet'", () => {
  const c = wv.marketChoices(AUTHS, makeState({ targetMarkets: ["schedule_m"] }));
  assert.deepEqual(c.map((x) => [x.key, x.checked, x.disabled]), [["schedule_m", true, false], ["us_fda", false, false], ["uk_mhra", false, true]]);
  assert.equal(c[2].note, "No data yet");
});

test("primaryChoices: only covered target markets can be the primary authority", () => {
  const c = wv.primaryChoices(AUTHS, makeState({ targetMarkets: ["us_fda", "uk_mhra", "schedule_m"], primaryAuthority: "us_fda" }));
  assert.deepEqual(c.map((x) => [x.key, x.checked]), [["schedule_m", false], ["us_fda", true]]);
});
