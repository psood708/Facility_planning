// PDF intake screens: upload panel, reading progress, the review list and the
// summary. Pure views over h(), rendered to plain objects here (as in
// results-view.test.js). Checks: labelled controls, nothing filled without a
// tick, conflicts as an unanswered choice, confidence in words, document text
// shown only as text.
const test = require("node:test");
const assert = require("node:assert/strict");
const IntakeView = require("../intake-view.js");

const mk = (tag, attrs = {}, children = []) => {
  if (attrs && "style" in attrs) throw new Error("inline style");
  if (attrs && "html" in attrs) throw new Error("html");
  const kids = (Array.isArray(children) ? children : [children]).filter((c) => c !== null && c !== undefined && c !== false);
  return { tag, attrs: attrs || {}, children: kids.map((c) => (typeof c === "number" ? String(c) : c)) };
};
const h = mk;
const text = (n) => (n === null || n === undefined ? "" : typeof n === "string" ? n : n.children.map(text).join(" "));
const all = (n, pred, out = []) => { if (!n || typeof n === "string") return out; if (pred(n)) out.push(n); n.children.forEach((c) => all(c, pred, out)); return out; };
const find = (n, pred) => all(n, pred)[0] || null;
const cls = (c) => (n) => (n.attrs.class || "").split(/\s+/).includes(c);

const LABELS = { param: (id) => ({ "DIM-001": "Room Net Area", "HVAC-001": "Cleanroom Grade / ISO Class", "SHE-006": "Emergency Shower / Eyewash Provision" })[id] || id, room: (id) => ({ "Z-29": "Aseptic Filling Suite", "Z-01": "Inward Material / Goods Receiving Bay" })[id] || id, market: (k) => k };
const src = (page, t) => ({ page, text: t });
function items() {
  return [
    { key: "note:0", target: { kind: "note" }, note: true, display: "UK MHRA is mentioned but not covered by this dataset, so it can't be checked.", sources: [src(1, "UK MHRA")], confidence: "low", checked: false },
    { key: "category", target: { kind: "category" }, value: "sterile", display: "Sterile", confidence: "high", reason: "category named in the document", sources: [src(1, "Sterile injectables")], conflict: false, same: false, replaces: null, checked: true },
    { key: "market:us_fda", target: { kind: "market" }, value: "us_fda", display: "US FDA", confidence: "medium", reason: "authority named", sources: [src(1, "for USFDA")], conflict: false, same: false, replaces: null, checked: false },
    { key: "param:facility:SHE-006", target: { kind: "param", scope: "facility", paramId: "SHE-006" }, value: true, display: "Yes", confidence: "high", reason: "table row", sources: [src(2, "Facility | Emergency Shower | Yes")], conflict: false, same: true, replaces: null, checked: false },
    { key: "room:Z-29", target: { kind: "room", roomId: "Z-29" }, value: "Z-29", display: "Aseptic Filling Suite", confidence: "high", reason: "room named", sources: [src(3, "Filling")], conflict: false, same: false, replaces: null, checked: true },
    { key: "param:room:Z-29:DIM-001", target: { kind: "param", scope: "room", roomId: "Z-29", paramId: "DIM-001" }, value: 120.03, display: "120.03 m²", confidence: "high", reason: "table column “Area (sq ft)”", converted: "from 1,292 sq ft", sources: [src(3, '<img src=x onerror="alert(1)"> Filling 1,292')], conflict: false, same: false, replaces: "100 m²", checked: true },
    { key: "param:room:Z-29:HVAC-001", target: { kind: "param", scope: "room", roomId: "Z-29", paramId: "HVAC-001" }, options: [
      { value: "Grade B", display: "Grade B", confidence: "high", sources: [src(3, "Grade B")] },
      { value: "Grade C (ISO 7)", display: "Grade C (ISO 7)", confidence: "medium", sources: [src(4, "ISO 7")] },
    ], confidence: "medium", sources: [], conflict: true, same: false, replaces: null, checked: false },
  ];
}
const review = (over = {}) => IntakeView.review(h, { items: items(), fileName: "Plant2.pdf", labels: LABELS, onApply: () => {}, onDiscard: () => {}, ...over });

test("upload panel: a labelled PDF file input and the privacy promise", () => {
  const p = IntakeView.uploadPanel(h, { onFile: () => {} });
  const input = find(p, (n) => n.tag === "input");
  assert.equal(input.attrs.type, "file");
  assert.equal(input.attrs.accept, "application/pdf,.pdf");
  assert.ok(find(p, (n) => n.tag === "label" && n.attrs.for === input.attrs.id), "visible label");
  assert.match(text(p), /never uploaded/i);
  const withError = IntakeView.uploadPanel(h, { onFile: () => {}, error: "This isn't a PDF." });
  assert.equal(find(withError, (n) => n.attrs.role === "alert").children.join(""), "This isn't a PDF.");
});

test("progress: page count in words, a live status line and Cancel", () => {
  let cancelled = false;
  const p = IntakeView.progress(h, { name: "Plant2.pdf", page: 3, pages: 8, source: "ocr", onCancel: () => { cancelled = true; } });
  const bar = find(p, (n) => n.tag === "progress");
  assert.deepEqual([bar.attrs.value, bar.attrs.max], ["3", "8"]);
  assert.match(text(find(p, (n) => n.attrs.role === "status")), /page 3 of 8.*scanned/i);
  find(p, (n) => n.tag === "button" && /Cancel/.test(text(n))).attrs.onclick();
  assert.equal(cancelled, true);
});

test("review: grouped by facility, then room; every checkbox labelled with field and value", () => {
  const r = review();
  const groups = all(r, cls("intake-group")).map((g) => text(find(g, (n) => n.tag === "h4")));
  assert.deepEqual(groups, ["Facility", "Aseptic Filling Suite"]);
  const boxes = all(r, (n) => n.tag === "input" && n.attrs.type === "checkbox");
  assert.ok(boxes.length >= 3);
  for (const b of boxes) {
    const label = find(r, (n) => n.tag === "label" && n.attrs.for === b.attrs.id);
    assert.ok(label, `label for ${b.attrs.id}`);
    assert.match(text(label), /:\s*\S/);
  }
  assert.ok(boxes.find((b) => b.attrs.checked === "checked"), "high-confidence values start ticked");
});

test("review: confidence in words, conversion and replacement disclosed, source as text", () => {
  const r = review();
  const area = all(r, cls("intake-row")).find((x) => /Room Net Area/.test(text(x)));
  assert.match(text(area), /High/);
  assert.match(text(area), /from 1,292 sq ft/);
  assert.match(text(area), /Replaces 100 m²/);
  assert.match(text(area), /p\.3/);
  assert.ok(all(area, (n) => n.children.includes('p.3: <img src=x onerror="alert(1)"> Filling 1,292')).length, "document text stays text");
  assert.deepEqual(all(r, (n) => n.attrs.title !== undefined), [], "no title tooltips");
});

test("review: conflicts are a radio choice with nothing chosen and a 'Don't fill' option", () => {
  const r = review();
  const fs = find(r, cls("intake-conflict"));
  assert.equal(fs.tag, "fieldset");
  assert.match(text(find(fs, (n) => n.tag === "legend")), /Cleanroom Grade/);
  const radios = all(fs, (n) => n.tag === "input" && n.attrs.type === "radio");
  assert.equal(radios.length, 3);
  assert.ok(radios.every((x) => x.attrs.checked === undefined), "no default");
  assert.ok(all(fs, (n) => n.tag === "label").some((l) => /Don.t fill/.test(text(l))));
});

test("review: values already in the project and notes are summarised, not offered", () => {
  const r = review();
  assert.match(text(r), /1 value already matches the project/);
  assert.match(text(find(r, cls("intake-notes"))), /UK MHRA/);
  assert.equal(all(r, cls("intake-row")).filter((x) => /Emergency Shower/.test(text(x))).length, 0);
});

test("review: Fill applies exactly the ticked values and chosen conflict options; the count follows the ticks", () => {
  let applied = null;
  const r = review({ onApply: (acc) => { applied = acc; } });
  const btn = find(r, (n) => n.tag === "button" && /^Fill the selected/.test(text(n)));
  assert.match(text(btn), /Fill the selected 3 values/);
  const box = (re) => { const row = all(r, cls("intake-row")).find((x) => re.test(text(x))); return find(row, (n) => n.tag === "input"); };
  box(/Room Net Area/).attrs.onchange({ target: { checked: false } });
  box(/Target market/).attrs.onchange({ target: { checked: true } });
  const radio = all(find(r, cls("intake-conflict")), (n) => n.tag === "input").find((x) => x.attrs.value === "0");
  radio.attrs.onchange({ target: { checked: true } });
  assert.match(text(btn), /Fill the selected 4 values/);
  btn.attrs.onclick();
  assert.deepEqual(applied.map((a) => a.target.kind + ":" + JSON.stringify(a.value)).sort(), ['category:"sterile"', 'market:"us_fda"', 'param:"Grade B"', 'room:"Z-29"'].sort());
});

test("review: 'Select all high-confidence' and 'Clear all' set the ticks", () => {
  let applied = null;
  const r = review({ onApply: (acc) => { applied = acc; } });
  find(r, (n) => n.tag === "button" && /Clear all/.test(text(n))).attrs.onclick();
  find(r, (n) => n.tag === "button" && /^Fill the selected/.test(text(n))).attrs.onclick();
  assert.deepEqual(applied, []);
  find(r, (n) => n.tag === "button" && /Select all high/.test(text(n))).attrs.onclick();
  find(r, (n) => n.tag === "button" && /^Fill the selected/.test(text(n))).attrs.onclick();
  assert.equal(applied.length, 3);
});

test("review with nothing found says so plainly", () => {
  const r = IntakeView.review(h, { items: [], fileName: "scan.pdf", labels: LABELS, onApply: () => {}, onDiscard: () => {} });
  assert.match(text(r), /Nothing in scan\.pdf could be matched/);
  assert.equal(find(r, (n) => n.tag === "button" && /^Fill the selected/.test(text(n))), null);
});

test("summary: what was filled, any errors, and a way to each step; ids unique across renders", () => {
  const ok = IntakeView.summary(h, { fileName: "Plant2.pdf", filled: 31, errors: [], onGo: () => {} });
  assert.match(text(ok), /31 values filled from Plant2\.pdf/);
  assert.equal(find(ok, (n) => n.tag === "h3").attrs.tabindex, "-1", "focus moves here");
  const bad = IntakeView.summary(h, { fileName: "Plant2.pdf", filled: 0, errors: ["roomValues.Z-01: bad"], onGo: () => {} });
  assert.match(text(bad), /Nothing was filled/);
  assert.match(text(bad), /roomValues\.Z-01: bad/);
  const ids = [review(), review(), ok].flatMap((n) => all(n, (x) => x.attrs.id).map((x) => x.attrs.id));
  assert.equal(new Set(ids).size, ids.length);
});

// ---------------------------------------------------------------- review follow-ups

test("review: each room group is a named group; each checkbox is described by its source and notes", () => {
  const r = review();
  for (const g of all(r, cls("intake-group"))) {
    assert.equal(g.attrs.role, "group");
    assert.equal(find(g, (n) => n.tag === "h4").attrs.id, g.attrs["aria-labelledby"]);
  }
  const area = all(r, cls("intake-row")).find((x) => /Room Net Area/.test(text(x)));
  const box = find(area, (n) => n.tag === "input");
  const ids = (box.attrs["aria-describedby"] || "").split(" ").filter(Boolean);
  assert.ok(ids.length >= 2);
  for (const id of ids) assert.ok(find(area, (n) => n.attrs.id === id), id);
  assert.match(text(find(area, (n) => n.tag === "label")), /High confidence/, "confidence is part of the label");
});

test("progress: updates in place (same nodes, so focus on Cancel survives) and announces only changes worth hearing", () => {
  const p = IntakeView.progress(h, { name: "big.pdf", page: 1, pages: 50, source: "text", onCancel: () => {} });
  const bar = find(p, (n) => n.tag === "progress");
  const cancel = find(p, (n) => n.tag === "button");
  assert.ok(bar.attrs["aria-labelledby"], "the progress bar has a name");
  const status = find(p, (n) => n.attrs.role === "status");
  p.intakeUpdate({ page: 2, pages: 50, source: "text" });
  assert.equal(find(p, (n) => n.tag === "progress"), bar);
  assert.equal(find(p, (n) => n.tag === "button"), cancel);
  assert.equal(bar.attrs.value, "2");
  assert.equal(text(status), "", "page 2 of a text PDF isn't announced");
  p.intakeUpdate({ page: 3, pages: 50, source: "ocr" });
  assert.match(text(status), /scanned/i, "switching to OCR is announced");
  cancel.attrs.onclick({ currentTarget: cancel });
  assert.match(text(cancel), /Cancelling/);
});
