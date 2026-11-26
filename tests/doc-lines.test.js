// PDF intake: rebuilding reading order and tables from positioned text items
// (pdf.js text layer or OCR words). Fixtures are synthetic but laid out like
// real documents: a long table whose room and parameter names wrap over
// several lines (as a printed results report does), a wide room-per-row
// table, a two-column page and rotated drawing labels.
const test = require("node:test");
const assert = require("node:assert/strict");
const DocLines = require("../doc-lines.js");

// One text item; width defaults to ~5.2 units per character at 10pt.
const it = (str, x, y, opts = {}) => ({ str, x, y, w: opts.w ?? str.length * 5.2, h: opts.h ?? 10, rot: opts.rot ?? 0, conf: opts.conf ?? 1 });

// A long table: ROOM | PARAMETER | ENTERED | SEVERITY, rows ~45 apart, wraps at +15.
function longTable() {
  return [
    it("ROOM", 72, 45), it("PARAMETER", 229, 45), it("ENTERED", 306, 45), it("SEVERITY", 398, 45),
    it("Facility", 72, 71), it("Water TOC", 229, 71), it("500", 306, 71), it("Partial", 402, 71), it("Per pharmacop", 463, 87),
    it("Inward Material / Goods", 72, 120), it("Receiving Bay", 72, 135), it("Room Clear", 229, 120), it("Height", 229, 135), it("2.75", 306, 120), it("Significant", 402, 120),
    it("Inward Material / Goods", 72, 170), it("Receiving Bay", 72, 185), it("Air Changes", 229, 170), it("per Hour", 229, 185), it("(ACH)", 229, 200), it("—", 306, 170), it("Critical", 402, 170),
    it("Captured, Not Auto-Checked (free text / no comparable value in this", 65, 260, { w: 449 }),
    it("Room Length (Inward Material / Goods Receiving Bay):", 76, 300), it("4.77", 343, 300),
  ];
}

test("toLines: groups items on the same baseline, left to right, and keeps reading order", () => {
  const lines = DocLines.toLines([it("b", 60, 10), it("a", 10, 10.4), it("c", 10, 30)]);
  assert.deepEqual(lines.map((l) => l.text), ["a b", "c"]);
  assert.deepEqual(lines[0].cells.map((c) => c.text), ["a", "b"], "a wide gap starts a new cell");
});

test("toLines: words close together stay in one cell; empty and whitespace items are dropped", () => {
  const lines = DocLines.toLines([it("Room", 10, 10), it("Clear", 37, 10), it("  ", 70, 10), it("", 80, 10)]);
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0].cells.map((c) => c.text), ["Room Clear"]);
});

test("toLines: rotated text (drawing labels) becomes separate label lines, never merged into rows", () => {
  const lines = DocLines.toLines([it("Area 120 m2", 10, 10), it("FILLING", 200, 10, { rot: Math.PI / 2 })]);
  const label = lines.find((l) => l.label);
  assert.equal(label.text, "FILLING");
  assert.equal(lines.find((l) => !l.label).text, "Area 120 m2");
});

test("toLines: a two-column page keeps its columns apart (cells, not one run-on cell)", () => {
  const lines = DocLines.toLines([it("Left column text", 40, 100), it("Right column text", 320, 100)]);
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0].cells.map((c) => c.text), ["Left column text", "Right column text"]);
});

test("tables: a long table with wrapped cells becomes one row per record", () => {
  const lines = DocLines.toLines(longTable());
  const isHeader = (l) => /^ROOM\b/.test(l.text);
  const [t] = DocLines.tables(lines, isHeader);
  assert.deepEqual(t.header, ["ROOM", "PARAMETER", "ENTERED", "SEVERITY"]);
  assert.deepEqual(t.rows.map((r) => r.slice(0, 3)), [
    ["Facility", "Water TOC", "500"],
    ["Inward Material / Goods Receiving Bay", "Room Clear Height", "2.75"],
    ["Inward Material / Goods Receiving Bay", "Air Changes per Hour (ACH)", "—"],
  ]);
  assert.equal(t.rows[0][3], "Partial Per pharmacop", "text right of the last header joins the last column");
});

test("tables: the table ends at a line that spans the columns; later lines stay free text", () => {
  const lines = DocLines.toLines(longTable());
  const [t] = DocLines.tables(lines, (l) => /^ROOM\b/.test(l.text));
  const used = new Set(t.lineIndexes);
  const free = lines.filter((_, i) => !used.has(i)).map((l) => l.text);
  assert.ok(free.some((x) => /^Captured, Not Auto-Checked/.test(x)));
  assert.ok(free.some((x) => /^Room Length \(Inward Material/.test(x)));
  assert.equal(t.rows.length, 3);
});

test("tables: a wide room-per-row table (one header per parameter)", () => {
  const items = [
    it("Room", 40, 50), it("Area (m²)", 220, 50), it("Grade", 300, 50), it("Temp (°C)", 380, 50),
    it("Dispensing Booth", 40, 70), it("18.5", 220, 70), it("Grade D", 300, 70), it("20-25", 380, 70),
    it("Aseptic Filling", 40, 88), it("120", 220, 88), it("Grade B", 300, 88), it("18-22", 380, 88),
  ];
  const [t] = DocLines.tables(DocLines.toLines(items), (l) => /^Room\b/.test(l.text));
  assert.deepEqual(t.header, ["Room", "Area (m²)", "Grade", "Temp (°C)"]);
  assert.deepEqual(t.rows, [["Dispensing Booth", "18.5", "Grade D", "20-25"], ["Aseptic Filling", "120", "Grade B", "18-22"]]);
});

test("tables: a header with no rows is not a table; empty input is empty", () => {
  assert.deepEqual(DocLines.toLines([]), []);
  assert.deepEqual(DocLines.tables([], () => true), []);
  const lines = DocLines.toLines([it("ROOM", 72, 45), it("PARAMETER", 229, 45), it("ENTERED", 306, 45)]);
  assert.deepEqual(DocLines.tables(lines, (l) => /^ROOM/.test(l.text)), []);
});

test("OCR words (with confidence) build lines the same way, keeping the lowest confidence per cell", () => {
  const lines = DocLines.toLines([it("Area", 10, 10, { conf: 0.95 }), it("12O", 36, 11, { conf: 0.6 })]);
  assert.equal(lines[0].cells[0].text, "Area 12O");
  assert.equal(lines[0].cells[0].conf, 0.6);
});

test("tables: a printed HTML/Word table with a wrapped header and vertically centred cells", () => {
  // Geometry from Chrome's print-to-PDF of a 6-column room table (11pt text).
  const items = [
    it("Room data sheet — sterile injectables facility", 30, 44, { h: 11 }),
    it("Area", 283, 101, { h: 11 }), it("Temp", 404, 101, { h: 11 }), it("RH", 468, 101, { h: 11 }), it("ΔP", 523, 101, { h: 11 }),
    it("Room", 41, 108, { h: 11 }), it("Grade", 344, 108, { h: 11 }),
    it("(m²)", 283, 114, { h: 11 }), it("(°C)", 404, 114, { h: 11 }), it("(%)", 468, 114, { h: 11 }), it("(Pa)", 523, 114, { h: 11 }),
    it("Aseptic Filling Suite", 41, 140, { h: 11 }), it("Grade", 344, 140, { h: 11 }),
    it("120", 283, 146, { h: 11 }), it("18-22", 404, 146, { h: 11 }), it("45-55", 468, 146, { h: 11 }), it("30", 523, 146, { h: 11 }),
    it("(Vials/Ampoules/PFS/Cartridge)", 41, 152, { h: 11 }), it("B", 344, 152, { h: 11 }),
    it("Grade", 344, 178, { h: 11 }), it("NMT", 468, 178, { h: 11 }),
    it("Dispensing / Weighing Room", 41, 185, { h: 11 }), it("18.5", 283, 185, { h: 11 }), it("20-25", 404, 185, { h: 11 }), it("15", 523, 185, { h: 11 }),
    it("D", 344, 191, { h: 11 }), it("60", 468, 191, { h: 11 }),
  ];
  const lines = DocLines.toLines(items);
  const [t] = DocLines.tables(lines, (l) => /^Room\b/.test(l.text));
  assert.deepEqual(t.header, ["Room", "Area (m²)", "Grade", "Temp (°C)", "RH (%)", "ΔP (Pa)"]);
  assert.deepEqual(t.rows, [
    ["Aseptic Filling Suite (Vials/Ampoules/PFS/Cartridge)", "120", "Grade B", "18-22", "45-55", "30"],
    ["Dispensing / Weighing Room", "18.5", "Grade D", "20-25", "NMT 60", "15"],
  ]);
  assert.ok(!t.lineIndexes.includes(0), "the title above the header is not part of the table");
});
