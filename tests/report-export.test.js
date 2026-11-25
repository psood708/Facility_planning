// Milestone 5: the exported gap report (a self-contained HTML document).
// It is built from the same model the results page renders, so these tests
// compare the export with the on-screen report gap by gap.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadData, makeState, engine } = require("./helpers.js");
const snap = require("../results-snapshot.js");
const model = require("../results-model.js");
const view = require("../results-view.js");
const { buildReport } = require("../report-export.js");

const DATA = loadData();
const LABELS = {
  market: (mk) => engine.reportLabel(DATA, mk),
  room: (id) => (DATA.roomById[id] || {}).name || id,
  param: (id) => (DATA.paramById[id] || {}).name || (id === "DIM-001-area" ? "Room Net Area" : id),
  threshold: (id) => (DATA.boolean_thresholds.find((b) => b.id === id) || {}).parameter_name || id,
};
const demo = (over = {}) =>
  makeState({
    category: "sterile", specificForms: ["Sterile Liquid (Vial)"], targetMarkets: ["schedule_m", "us_fda", "pics"], primaryAuthority: "schedule_m",
    selectedRooms: ["Z-29", "Z-01"], facilityValues: { "UTIL-001": "Class 2" },
    roomValues: { "Z-29": { "DIM-001": 120, "HVAC-001": "Grade B", "HVAC-002": { min: 19, max: 24 } } },
    ...over,
  });
function modelFor(st) {
  const s = engine.reportState(DATA, st);
  const targets = st.targetMarkets.map((k) => engine.reportKeyFor(DATA, k)).filter(Boolean);
  return model.build(snap.compact(engine.evaluateAll(DATA, s), s), LABELS, { targets });
}
const META = { dataDate: "2026-11-24", dataHash: "7d9b15b3c16c5d83cff53bfed25db429df3042e60bca39bd6886aa8e15d5f4e3", engineVersion: "0.2.0", generatedAt: "2026-11-26T10:30:00Z" };
const FACILITY = (st) => ({
  category: "Sterile", forms: st.specificForms, targets: ["India — Schedule M", "US FDA", "EU-GMP / PIC/S"], primary: "India — Schedule M",
});
function exportFor(st = demo(), name = "Plant 2 — sterile block") {
  return buildReport({ model: modelFor(st), project: { name }, facility: FACILITY(st), meta: META });
}

// Plain-object h(), as in the view tests, to read what the screen shows.
const mk = (tag, attrs = {}, children = []) => {
  const kids = (Array.isArray(children) ? children : [children]).filter((c) => c !== null && c !== undefined && c !== false);
  return { tag, attrs: attrs || {}, children: kids.map((c) => (typeof c === "number" ? String(c) : c)) };
};
const text = (n) => (n === null || n === undefined ? "" : typeof n === "string" ? n : n.children.map(text).join(" "));
const all = (n, pred, out = []) => { if (!n || typeof n === "string") return out; if (pred(n)) out.push(n); n.children.forEach((c) => all(c, pred, out)); return out; };
const cls = (c) => (n) => (n.attrs.class || "").split(/\s+/).includes(c);
const find = (n, pred) => all(n, pred)[0] || null;

// What the screen shows for each gap: change, label, source, authorities satisfied.
function screenGaps(st = demo()) {
  const page = view.resultsPage(mk, mk, modelFor(st), { labels: LABELS });
  return all(page, cls("fix-row")).map((row) => ({
    change: text(find(row, cls("fix-change"))).trim(),
    label: text(find(row, cls("fix-obligation"))).trim(),
    source: text(find(row, cls("fix-source"))).replace(/^Source:\s*/, "").trim(),
    satisfies: text(find(row, cls("fix-satisfies"))).trim(),
  }));
}

// The same four facts read back out of the exported document.
const unescape = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const field = (li, c) => { const m = li.match(new RegExp(`class="${c}"[^>]*>([\\s\\S]*?)</`)); return m ? unescape(m[1]).trim() : ""; };
function exportedGaps(html) {
  return [...html.matchAll(/<li class="gap"[\s\S]*?<\/li>/g)].map((m) => ({
    change: field(m[0], "gap-change"),
    label: field(m[0], "gap-label"),
    source: field(m[0], "gap-source"),
    satisfies: field(m[0], "gap-satisfies"),
  }));
}

test("the export contains every on-screen gap, in the same order, with the same change, label, source and reach", () => {
  const screen = screenGaps();
  assert.ok(screen.length >= 3, "a report with several gaps");
  assert.deepEqual(exportedGaps(exportFor().html), screen);
});

test("every gap in the export has a source, a mandatory/recommended label and a suggested change", () => {
  for (const g of exportedGaps(exportFor().html)) {
    assert.ok(g.change.length > 25, g.change);
    assert.ok(g.source.length > 3, g.source);
    assert.match(g.label, /^(Mandatory|Recommended)( \(draft\))?$|^Not yet classified$|^Advisory \(international standard\)$/);
  }
});

test("the export states the benchmark data date, version and when it was generated", () => {
  const { html } = exportFor();
  assert.match(html, /Benchmark data as of 24 Nov 2026/);
  assert.match(html, /Rules engine 0\.2\.0/);
  assert.match(html, /7d9b15b3c16c/);
  assert.match(html, /Generated 26 Nov 2026/);
});

test("the export carries a clear advisory disclaimer, at the top and at the end", () => {
  const { html } = exportFor();
  const hits = html.match(/not a regulatory sign-off/gi) || [];
  assert.ok(hits.length >= 2, "disclaimer at top and bottom");
  assert.ok(html.indexOf("not a regulatory sign-off") < html.indexOf('class="gap"'), "before the first gap");
});

test("the export includes facility details and one line per covered authority", () => {
  const { html } = exportFor();
  assert.match(html, /Plant 2 — sterile block/);
  assert.match(html, /Sterile Liquid \(Vial\)/);
  assert.match(html, /Primary authority[\s\S]*India — Schedule M/);
  const rows = html.match(/<tr class="authority-row"/g) || [];
  assert.equal(rows.length, 6);
  assert.match(html, /EU-GMP \/ PIC\/S[\s\S]*?Your target/);
});

test("all text is escaped; the document runs no script and locks itself down", () => {
  const evil = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  const m = modelFor(demo());
  m.gapGroups[0].fixes[0].change = evil;
  const { html } = buildReport({ model: m, project: { name: evil }, facility: { ...FACILITY(demo()), forms: [evil] }, meta: META });
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<img/i);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">/);
});

test("no gaps: the export says so plainly, in the screen's words", () => {
  const m = constructed([row("C1", "compliant")], []);
  const html = exportHtml(m);
  assert.equal(exportedGaps(html).length, 0);
  assert.match(screenText(m), /Nothing to fix against any covered authority/);
  assert.match(html, /Nothing to fix against any covered authority/);
});

test("the file name is safe and dated", () => {
  assert.equal(exportFor(demo(), "Plant 2 — sterile block / Line A").filename, "gap-report-plant-2-sterile-block-line-a-2026-11-26.html");
  assert.equal(exportFor(demo(), "   ").filename, "gap-report-project-2026-11-26.html");
});

// ---------------------------------------------------------------- review: every state, every field

// A model built straight from a snapshot, for states real data rarely produces.
function constructed(evaluations, recommendations) {
  const SIX = ["schedule_m", "us_fda", "eu_gmp", "who_gmp", "china_nmpa", "japan_pmda"];
  return model.build({ rollup: Object.fromEntries(SIX.map((mk) => [mk, "Partial"])), evaluations, checklist: [], recommendations }, LABELS);
}
const row = (threshold, status, fallback) => ({ room: null, param: "UTIL-001", threshold, markets: Object.fromEntries(["schedule_m", "us_fda", "eu_gmp", "who_gmp", "china_nmpa", "japan_pmda"].map((mk) => [mk, { status, fallback: fallback || null }])) });
const screenText = (m) => text(view.resultsPage(mk, mk, m, { labels: LABELS }));
const exportHtml = (m, meta = META) => buildReport({ model: m, project: { name: "P" }, facility: FACILITY(demo()), meta }).html;

test("advisory-only: the export says what the screen says — nothing to fix against any authority — then the advice", () => {
  const m = constructed([row("C1", "compliant"), row("A1", "not_regulated", "non_compliant")], [{ id: "A1", severity: "Partial", obligation: "unclassified", change: "Set A1 to the international reference value for this room.", sources: ["ISO 14644"], obligationStatus: "fixed" }]);
  assert.match(screenText(m), /Nothing to fix against any covered authority/);
  const html = exportHtml(m);
  assert.match(html, /Nothing to fix against any covered authority/);
  assert.doesNotMatch(html, /Mandatory gaps first/);
  assert.deepEqual(exportedGaps(html).map((g) => g.label), ["Advisory (international standard)"]);
});

test("nothing checked: no gaps and the export says so in the screen's words", () => {
  const m = constructed([row("N1", "no_value")], []);
  assert.match(screenText(m), /Nothing was checked yet/);
  const html = exportHtml(m);
  assert.equal(exportedGaps(html).length, 0);
  assert.match(html, /Nothing was checked yet/);
});

test("all values pass: the export says there is nothing to fix", () => {
  const m = constructed([row("P1", "compliant")], []);
  const html = exportHtml(m);
  assert.equal(exportedGaps(html).length, 0);
  assert.match(html, /Nothing to fix against any covered authority/);
});

test("a gap with no recorded source says so, on screen and in the export", () => {
  const m = constructed([row("S1", "non_compliant")], [{ id: "S1", severity: "Significant", obligation: "mandatory", change: "Set S1 to the required value for every authority.", sources: [], obligationStatus: "draft" }]);
  const [g] = exportedGaps(exportHtml(m));
  assert.equal(g.source, "No source recorded");
  assert.match(screenText(m), /Source: No source recorded/);
});

test("groups larger than five match the screen gap for gap (the screen hides the rest behind 'Show all')", () => {
  const rooms = DATA.rooms.filter((r) => r.applies_to.sterile).map((r) => r.id);
  const st = demo({ selectedRooms: rooms, roomValues: Object.fromEntries(rooms.map((id) => [id, { "HVAC-001": "Unclassified/CNC", "DIM-001": 1 }])) });
  const screen = screenGaps(st);
  assert.ok(screen.length > 10, `${screen.length} gaps`);
  assert.deepEqual(exportedGaps(exportFor(st).html), screen);
});

test("a missing data date reads 'date unknown', never 'undefined'", () => {
  const html = exportHtml(modelFor(demo()), { ...META, dataDate: undefined });
  assert.match(html, /Benchmark data as of date unknown/);
  assert.doesNotMatch(html, /undefined/);
});

test("every user-controlled field is escaped, including the title, attributes and sources", () => {
  const evil = `"><img src=x onerror=1>'`;
  const m = modelFor(demo());
  const f = m.gapGroups.find((g) => g.fixes.length).fixes[0];
  Object.assign(f, { id: evil, change: evil, label: evil, roomLabel: evil, sources: [evil] });
  const labels = { ...LABELS, market: () => evil };
  const html = buildReport({ model: m, labels, project: { name: evil }, facility: { category: evil, forms: [evil], targets: [evil], primary: evil }, meta: { ...META, engineVersion: evil } }).html;
  const body = html.replace(/<style>[\s\S]*?<\/style>/, "");
  assert.doesNotMatch(body, /<img/i);
  assert.equal(body.includes(`"><img`), false, "the payload never breaks out of an attribute or tag");
  assert.match(html, /<title>Gap report — &quot;&gt;&lt;img src=x onerror=1&gt;&#39;<\/title>/);
  assert.match(html, /data-id="&quot;&gt;&lt;img src=x onerror=1&gt;&#39;"/);
});

test("the exported document's policy also forbids <base> and forms", () => {
  assert.match(exportFor().html, /content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"/);
});
