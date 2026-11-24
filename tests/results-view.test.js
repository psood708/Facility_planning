// Step 4 charts. results-view.js takes h() and s() as parameters, so every
// state renders to plain objects here — no DOM. Checks the accessibility
// contract: figures with captions, SVG role="img" with title/desc, a table
// view for every chart, colour always paired with a glyph and a word.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadData, makeState, engine } = require("./helpers.js");
const snap = require("../results-snapshot.js");
const model = require("../results-model.js");
const view = require("../results-view.js");

const DATA = loadData();
const LABELS = {
  market: (mk) => engine.marketLabel(DATA, mk),
  room: (id) => (DATA.roomById[id] || {}).name || id,
  param: (id) => (DATA.paramById[id] || {}).name || (id === "DIM-001-area" ? "Room Net Area" : id),
  threshold: (id) => (DATA.boolean_thresholds.find((b) => b.id === id) || {}).parameter_name || id,
};

const mk = (ns) => (tag, attrs = {}, children = []) => {
  if (attrs && "style" in attrs) throw new Error("inline style");
  const kids = (Array.isArray(children) ? children : [children]).filter((c) => c !== null && c !== undefined && c !== false);
  return { ns, tag, attrs: attrs || {}, children: kids.map((c) => (typeof c === "number" ? String(c) : c)) };
};
const h = mk("html");
const s = mk("svg");
const text = (n) => (n === null || n === undefined ? "" : typeof n === "string" ? n : n.children.map(text).join(" "));
const all = (n, pred, out = []) => {
  if (!n || typeof n === "string") return out;
  if (pred(n)) out.push(n);
  n.children.forEach((c) => all(c, pred, out));
  return out;
};
const find = (n, pred) => all(n, pred)[0] || null;
const cls = (c) => (n) => (n.attrs.class || "").split(/\s+/).includes(c);
const tag = (t) => (n) => n.tag === t;

const demo = (over = {}) =>
  makeState({
    category: "sterile",
    specificForms: ["Sterile Liquid (Vial)"],
    targetMarkets: ["schedule_m", "us_fda", "eu_gmp", "who_gmp"],
    selectedRooms: ["Z-29", "Z-01"],
    facilityValues: { "UTIL-001": "Class 2" },
    roomValues: { "Z-29": { "DIM-001": 120, "HVAC-001": "Grade B", "HVAC-002": { min: 19, max: 24 } } },
    ...over,
  });
function live(st = demo()) {
  const all_ = engine.evaluateAll(DATA, st);
  const m = model.build(snap.compact(all_, st), LABELS);
  return view.resultsPage(h, s, m, { numeric: model.numericGaps(all_.rows, st.targetMarkets, LABELS), labels: LABELS });
}

test("hero states the headline in counts: frameworks met, gaps, critical", () => {
  const page = live();
  const hero = find(page, cls("results-hero"));
  assert.match(text(hero), /Meets 0 of 4 frameworks/);
  assert.match(text(hero), /4 gaps, 1 critical/);
});

test("every chart is a figure with a caption, a labelled SVG and a table view", () => {
  const page = live();
  const svgs = all(page, (n) => n.ns === "svg" && n.tag === "svg");
  assert.ok(svgs.length >= 5, `found ${svgs.length} svgs`);
  for (const svg of svgs) {
    assert.equal(svg.attrs.role, "img");
    const [t, d] = svg.attrs["aria-labelledby"].split(" ");
    assert.equal(find(svg, (n) => n.tag === "title").attrs.id, t);
    assert.equal(find(svg, (n) => n.tag === "desc").attrs.id, d);
    assert.ok(text(find(svg, (n) => n.tag === "title")).length > 3);
    assert.equal(find(svg, (n) => ["a", "button", "foreignObject"].includes(n.tag) || "tabindex" in n.attrs), null, "nothing focusable inside role=img");
  }
  const figures = all(page, tag("figure"));
  assert.ok(figures.length >= 3);
  for (const f of figures) {
    assert.ok(find(f, tag("figcaption")), "figcaption");
    const table = find(f, tag("table"));
    assert.ok(table, "figure has a table (or table view)");
    assert.ok(find(table, tag("caption")), "table caption");
    all(table, tag("th")).forEach((th) => assert.ok(["col", "row"].includes(th.attrs.scope), "th scope"));
  }
});

test("ids are unique even across two renders", () => {
  const ids = [live(), live()].flatMap((p) => all(p, (n) => n.attrs.id).map((n) => n.attrs.id));
  assert.equal(new Set(ids).size, ids.length);
});

test("scorecards: one strip per authority with glyph + verdict word, X of Y met and gaps by severity", () => {
  const page = live();
  const cards = all(page, cls("scorecard"));
  assert.equal(cards.length, 4);
  const eu = cards.find((c) => text(c).includes("EU-GMP"));
  const badge = find(eu, cls("verdict-badge"));
  assert.ok(cls("verdict-non_compliant")(badge));
  assert.match(text(badge), /✗/);
  assert.match(text(badge), /Non-compliant/);
  assert.match(text(eu), /\d+ of \d+ checks met/);
  assert.match(text(eu), /1 critical/);
  assert.match(text(find(page, cls("scorecards"))), /worst gap/i);
});

test("legend items always pair a swatch, a glyph and a text label", () => {
  const page = live();
  const items = all(page, cls("legend-item"));
  assert.ok(items.length > 0);
  for (const it of items) {
    assert.ok(find(it, cls("swatch")), "swatch");
    assert.ok(find(it, cls("glyph")), "glyph");
    assert.ok(/[a-z]{3}/i.test(text(it)), `label in ${text(it)}`);
  }
});

test("segments too narrow for a label print none; text is never filled with a status colour", () => {
  const page = live();
  // No SVG text at all: labels live in HTML.
  assert.equal(all(page, (n) => n.ns === "svg" && n.tag === "text").length, 0);
});

test("fix list: top 5, satisfies N of M authorities, advisory group separate, show all", () => {
  const rooms = DATA.rooms.map((r) => r.id);
  const values = Object.fromEntries(rooms.map((id) => [id, { "HVAC-001": "Unclassified/CNC", "DIM-001": 1 }]));
  const page = live(demo({ selectedRooms: rooms, roomValues: values }));
  const fixes = find(page, cls("fix-list"));
  const top = find(fixes, cls("fixes-top"));
  assert.equal(all(top, tag("li")).length, 5);
  assert.match(text(top), /Satisfies \d of 4 authorities/);
  const more = find(fixes, (n) => n.tag === "details" && /Show all/.test(text(find(n, tag("summary")))));
  assert.ok(more);
  const adv = find(live(demo({ targetMarkets: ["schedule_m"] })), cls("fixes-advisory"));
  assert.ok(adv, "advisory group");
  assert.match(text(adv), /international/i);
  assert.match(text(adv), /does not affect/i);
});

test("room grid: scrollable labelled region, glyph + text in cells, capped at 15 rows", () => {
  const rooms = DATA.rooms.map((r) => r.id);
  const page = live(demo({ selectedRooms: rooms }));
  const region = find(page, cls("grid-scroll"));
  assert.equal(region.attrs.role, "region");
  assert.equal(region.attrs.tabindex, "0");
  assert.ok(region.attrs["aria-label"]);
  const rows = all(find(region, tag("tbody")), tag("tr"));
  assert.ok(rows.length > 15);
  assert.equal(rows.filter((r) => !r.attrs.hidden).length, 15);
  assert.ok(find(page, (n) => n.tag === "button" && /Show all \d+ rows/.test(text(n))));
  const fail = find(region, cls("cell-fail"));
  assert.match(text(fail), /✗/);
  assert.match(text(fail), /not met/);
  // Sticky first column = row headers.
  rows.forEach((r) => assert.equal(r.children[0].tag, "th"));
});

test("numeric bullet charts: failing rows only, authority + advisory fallback bands, units", () => {
  const page = live();
  const sec = find(page, cls("numeric-section"));
  const items = all(sec, cls("bullet"));
  assert.ok(items.length >= 2);
  const temp = items.find((i) => /Temperature/i.test(text(i)));
  assert.ok(temp, items.map(text).join("|"));
  assert.match(text(temp), /°C/);
  assert.match(text(temp), /19–24/);
  assert.ok(find(temp, cls("band-fallback")), "fallback band");
  assert.match(text(temp), /advisory/i);
});

test("numeric: entered values far off the bands are clamped and marked off scale", () => {
  const page = live(demo({ roomValues: { "Z-29": { "DIM-001": 1, "HVAC-002": { min: 19, max: 240 } } } }));
  const temp = all(page, cls("bullet")).find((i) => /Temperature/i.test(text(i)));
  assert.match(text(temp), /off scale/i);
  for (const n of all(temp, (x) => x.ns === "svg")) {
    for (const k of ["x", "x1", "x2", "cx", "width"]) {
      if (n.attrs[k] === undefined || !String(n.attrs[k]).endsWith("%")) continue;
      const v = parseFloat(n.attrs[k]);
      assert.ok(v >= 0 && v <= 100, `${k}=${n.attrs[k]}`);
    }
  }
});

test("numeric: cap at 12 with a note", () => {
  const g = Array.from({ length: 20 }, (_, i) => ({ id: "n" + i, room: null, roomLabel: "Facility", label: "P" + i, unit: "Pa", entered: 5, bands: { eu_gmp: { min: 10, max: 15, status: "non_compliant" } }, fallback: null, conflict: null, state: "fail", severity: "Partial" }));
  const sec = view.numericSection(h, s, g, { labels: LABELS });
  assert.equal(all(sec, cls("bullet")).length, 12);
  assert.match(text(sec), /12 of 20/);
});

test("conflicting authorities are explained in text first", () => {
  const g = [{ id: "c", room: null, roomLabel: "Facility", label: "Pressure", unit: "Pa", entered: 12, bands: { eu_gmp: { min: 10, max: 15, status: "compliant" }, us_fda: { min: 20, max: null, status: "non_compliant" } }, fallback: null, conflict: { markets: ["eu_gmp", "us_fda"], reference: null }, state: "fail", severity: "Partial" }];
  const item = find(view.numericSection(h, s, g, { labels: LABELS }), cls("bullet"));
  const first = item.children.find((c) => typeof c !== "string" && /conflict/i.test(text(c)));
  assert.ok(first);
  assert.ok(item.children.indexOf(first) < item.children.findIndex((c) => c.ns === "svg" || find(c, (x) => x.ns === "svg")));
});

test("no gaps: positive message instead of empty charts", () => {
  const st = demo({ facilityValues: {}, roomValues: { "Z-29": { "HVAC-001": "Grade A (ISO 5)" } } });
  const page = live(st);
  assert.match(text(find(page, cls("fix-list"))), /Nothing to fix/i);
  assert.equal(find(page, cls("severity-chart")), null);
});

test("partial data: no-value count is shown with a note", () => {
  const page = live();
  assert.match(text(page), /no value entered/i);
  assert.match(text(page), /not counted as met or not met/i);
  assert.match(text(find(page, cls("results-hero"))), /Based on \d+ checked values?; \d+ checks? have no value entered/);
});

test("everything not covered: never green, says nothing was checked", () => {
  const page = live(demo({ targetMarkets: ["uk_mhra", "sfda"] }));
  assert.equal(find(page, cls("verdict-compliant")), null);
  assert.match(text(find(page, cls("results-hero"))), /not covered/i);
  assert.doesNotMatch(text(page), /within each authority's range/, "no false all-clear");
  assert.match(text(find(page, cls("numeric-section"))), /no number to compare/i);
  assert.match(text(find(page, cls("fix-list"))), /Nothing was checked/i);
});

test("no markets / empty model: a message only", () => {
  const page = view.resultsPage(h, s, model.build({ rollup: {} }, LABELS), {});
  assert.match(text(page), /No results to show/i);
  assert.equal(all(page, (n) => n.tag === "svg").length, 0);
});

test("single market renders without a grid comparison problem", () => {
  const page = live(demo({ targetMarkets: ["eu_gmp"] }));
  assert.equal(all(page, cls("scorecard")).length, 1);
  assert.match(text(find(page, cls("results-hero"))), /of 1 framework\b/);
});

test("stale (as saved): no numeric charts, re-evaluate note, labelled as saved", () => {
  const st = demo();
  const m = model.build(snap.compact(engine.evaluateAll(DATA, st), st), LABELS);
  const page = view.resultsPage(h, s, m, { stale: true, labels: LABELS });
  assert.match(text(page), /as saved/i);
  assert.match(text(page), /Detailed numeric comparison is available after re-evaluating/);
  assert.equal(find(page, cls("bullet")), null);
  assert.equal(find(page, (n) => n.tag === "input" || n.tag === "select"), null);
});

test("markup-looking labels stay text", () => {
  const evil = '<img src=x onerror="alert(1)">';
  const st = demo();
  const m = model.build(snap.compact(engine.evaluateAll(DATA, st), st), { ...LABELS, room: () => evil });
  const page = view.resultsPage(h, s, m, { labels: LABELS });
  assert.ok(all(page, (n) => n.children.includes(evil)).length > 0);
});

// axe "scrollable-region-focusable" (found by e2e/a11y.e2e.js): anything that
// can scroll sideways must be reachable by keyboard and named.
test("every scrolling wrapper is a focusable, labelled region", () => {
  const page = live();
  const scrollers = all(page, (n) => cls("table-scroll")(n) || cls("grid-scroll")(n));
  assert.ok(scrollers.length >= 2, "expected the table views and the room grid to scroll");
  for (const n of scrollers) {
    assert.equal(n.attrs.role, "region", JSON.stringify(n.attrs));
    assert.equal(String(n.attrs.tabindex), "0");
    assert.ok((n.attrs["aria-label"] || "").trim().length > 0, "region needs a name");
  }
});

test("scrollRegion builds the same focusable, labelled wrapper for app.js detail tables", () => {
  const r = view.scrollRegion(h, "Detailed parameter status", h("table", {}, []));
  assert.deepEqual([r.attrs.class, r.attrs.role, String(r.attrs.tabindex), r.attrs["aria-label"]], ["table-scroll", "region", "0", "Detailed parameter status"]);
});

// ---------------------------------------------------------------- one authority (Milestone 3)

const authorityOpts = (current = "schedule_m") => {
  const c = snap.compact(engine.evaluateAll(DATA, demo()), demo());
  return {
    view: model.forAuthority(c, current, LABELS),
    choices: ["schedule_m", "us_fda", "eu_gmp", "who_gmp"].map((k) => ({ key: k, label: LABELS.market(k) })),
    onSwitch: () => {},
  };
};

test("authorityView: one captioned table per room with glyph + word per requirement", () => {
  const sec = view.authorityView(h, authorityOpts());
  assert.match(text(find(sec, tag("h3"))), /India — Schedule M/);
  const tables = all(sec, tag("table"));
  assert.ok(tables.length >= 2, "facility + at least one room");
  for (const t of tables) {
    assert.ok(find(t, tag("caption")), "each room table has a caption");
    for (const th of all(t, tag("th"))) assert.ok(th.attrs.scope, "every header has a scope");
  }
  const cells = all(sec, cls("auth-status"));
  assert.ok(cells.length > 0);
  for (const c of cells) assert.match(text(c), /^(✓ Pass|✗ Fail|⊘ Not covered|\? No value)/);
});

test("authorityView: the switcher offers the chosen authorities and marks the current one", () => {
  const sec = view.authorityView(h, authorityOpts("us_fda"));
  const buttons = all(sec, (n) => n.tag === "button" && n.attrs["aria-pressed"] !== undefined);
  assert.deepEqual(buttons.map((b) => [text(b).trim(), b.attrs["aria-pressed"]]),
    ["schedule_m", "us_fda", "eu_gmp", "who_gmp"].map((k) => [LABELS.market(k), String(k === "us_fda")]));
});

test("resultsPage leads with the primary authority, then 'Compare with other authorities'", () => {
  const page = view.resultsPage(h, s, model.build(snap.compact(engine.evaluateAll(DATA, demo()), demo()), LABELS), { labels: LABELS, authority: authorityOpts() });
  // Headings stay under Step 4's h2: the comparison heading is an h3 like the sections it introduces.
  const order = all(page, (n) => n.tag === "h3" || cls("auth-view")(n));
  const iAuth = order.findIndex(cls("auth-view"));
  const iCompare = order.findIndex((n) => n.tag === "h3" && /Compare with other authorities/.test(text(n)));
  assert.ok(iAuth > -1 && iCompare > iAuth, `auth ${iAuth}, compare ${iCompare}`);
  assert.ok(find(page, cls("scorecards")) || all(page, tag("figure")).length > 0, "comparison charts still render");
});

test("authorityView notes are short enough for a phone column", () => {
  for (const n of all(view.authorityView(h, authorityOpts()), cls("auth-note"))) assert.ok(text(n).length <= 60, text(n));
});

test("with nothing to compare, the 'Compare with other authorities' heading is not shown", () => {
  const page = view.resultsPage(h, s, model.build({ rollup: {} }, LABELS), { authority: authorityOpts() });
  assert.equal(find(page, (n) => n.tag === "h3" && /Compare with other authorities/.test(text(n))), null);
  assert.ok(find(page, cls("auth-view")), "the authority section still shows");
});
