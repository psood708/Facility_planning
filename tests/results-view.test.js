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
  market: (mk) => engine.reportLabel(DATA, mk), // combined "EU-GMP / PIC/S", as the app shows it
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

test("the page opens with a verdict per market, in plain words, with the planner's targets first", () => {
  const page = report(demo({ targetMarkets: ["us_fda", "who_gmp"] }));
  const sec = find(page, cls("results-verdicts"));
  const items = all(sec, cls("verdict-item"));
  assert.equal(items.length, 6);
  assert.match(text(items[0]), /United States \(FDA\)/);
  assert.match(text(items[1]), /WHO/);
  assert.ok(/Your target/.test(text(items[0])) && /Your target/.test(text(items[1])) && !/Your target/.test(text(items[2])));
  const nmpa = items.find((i) => /China \(NMPA\)/.test(text(i)));
  assert.ok(nmpa, "country names, e.g. China (NMPA)");
  for (const it of items) assert.ok(find(it, cls("glyph")) && find(it, cls("verdict-word")), "glyph + word");
  assert.match(text(items.find((i) => /European Union/.test(text(i)))), /Non-compliant/);
});

test("headline: completeness next to the verdicts, then 'N changes (M authority-gaps)'", () => {
  const sec = find(report(), cls("results-verdicts"));
  assert.match(text(find(sec, cls("completeness"))), /^\d+ of \d+ checks have values/);
  assert.match(text(find(sec, cls("headline"))), /^\d+ changes \(\d+ authority-gaps\), 1 critical/);
  assert.doesNotMatch(text(sec), /Meets 0 of|\b0 of \d+ checks met/);
});

test("section order: verdicts, top fixes, room grid, range charts, per-authority detail, primary-authority evidence last", () => {
  const page = view.resultsPage(h, s, model.build(snap.compact(engine.evaluateAll(DATA, demo()), demo()), LABELS), { labels: LABELS, authority: authorityOpts(), numeric: model.numericGaps(engine.evaluateAll(DATA, demo()).rows, demo().targetMarkets, LABELS) });
  const order = ["results-verdicts", "fix-list", "room-grid", "numeric-section", "scorecards", "auth-view"];
  const seen = all(page, (n) => order.some((c) => cls(c)(n))).map((n) => order.find((c) => cls(c)(n)));
  assert.deepEqual(seen, order);
  assert.equal(find(page, (n) => /Compare with other authorities/.test(text(n)) && n.tag === "h3"), null);
});

test("one vocabulary on screen: Has gaps / Minor / Needs value / No rule set — never 'Partial'", () => {
  const t = text(view.resultsPage(h, s, model.build(snap.compact(engine.evaluateAll(DATA, demo()), demo()), LABELS), { labels: LABELS, authority: authorityOpts() }));
  assert.doesNotMatch(t, /\bPartial\b/);
  assert.match(t, /Has gaps/);
  assert.match(t, /Minor/);
  assert.match(t, /Needs value/i);
  assert.match(t, /No rule set/i);
  assert.doesNotMatch(t, /not regulated here|not covered by dataset|no value entered/i, "old status words are gone");
});

test("every chart is a figure with a caption, a labelled SVG and a table view", () => {
  const page = live();
  const svgs = all(page, (n) => n.ns === "svg" && n.tag === "svg").filter((n) => n.attrs["aria-hidden"] !== "true");
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
    assert.equal(find(find(f, tag("figcaption")), cls("fig-title")).tag, "h4", "the figure title is a heading");
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

test("scorecard bars count checked values only; the rest is said in words", () => {
  const cards = all(find(live(), cls("scorecards")), cls("scorecard"));
  for (const c of cards) {
    const segs = all(find(c, cls("status-bar")), (n) => n.ns === "svg" && cls("seg")(n)).filter((n) => !cls("seg-empty")(n));
    for (const seg of segs) assert.ok(cls("st-compliant")(seg) || cls("st-non_compliant")(seg), seg.attrs.class);
    assert.doesNotMatch(text(find(c, cls("sc-legend")) || { children: [] }), /needs value|no rule set/);
  }
  const eu = cards.find((c) => /European Union/.test(text(c)));
  assert.match(text(find(eu, cls("sc-unchecked"))), /^\d+ need a value · \d+ no rule set$/);
});

test("authority × severity matrix: one row per market (verdict order), counts by severity, in a captioned table", () => {
  const page = report(demo({ targetMarkets: ["us_fda"] }));
  const mx = find(find(page, cls("results-verdicts")), cls("severity-matrix"));
  assert.ok(mx, "matrix inside the verdict section");
  assert.equal(mx.tag, "figure");
  const table = find(mx, tag("table"));
  assert.ok(find(table, tag("caption")));
  assert.deepEqual(all(find(table, tag("thead")), tag("th")).map((n) => text(n).trim()), ["Authority", "Critical", "Significant", "Minor"]);
  const rows = all(find(table, tag("tbody")), tag("tr"));
  assert.equal(rows.length, 6);
  assert.match(text(rows[0].children[0]), /United States/, "targets first, as in the verdicts");
  const eu = rows.find((r) => /European Union/.test(text(r)));
  assert.deepEqual(eu.children.slice(1).map((c) => text(c).replace(/\D/g, "")), ["1", "1", "1"]);
  for (const c of all(table, cls("mx-cell"))) {
    const n = Number(text(c).replace(/\D/g, "") || 0);
    assert.equal(cls("mx-zero")(c), n === 0, text(c));
  }
  assert.equal(find(page, cls("severity-chart")), null, "the severity bar is replaced");
  assert.equal(find(page, cls("hero-stats")), null);
});

test("matrix rows for markets with nothing checked say so instead of zeros", () => {
  const page = report(demo({ roomValues: { "Z-29": { "DIM-001": 120 } }, facilityValues: {} }));
  const rows = all(find(find(page, cls("severity-matrix")), tag("tbody")), tag("tr"));
  const fda = rows.find((r) => /United States/.test(text(r)));
  assert.match(text(fda), /Nothing checked/);
});

test("fix rows: a severity rail and a strip of the six authorities, filled where the change satisfies one", () => {
  const rows = all(find(report(), cls("gap-gaps")), cls("fix-row"));
  for (const r of rows) {
    assert.ok(["critical", "significant", "partial"].some((k) => cls("fix-sev-" + k)(r)), r.attrs.class);
    const strip = find(r, cls("unlock-strip"));
    assert.equal(strip.attrs["aria-hidden"], "true", "the words carry it for screen readers");
    const cells = all(strip, cls("unlock-cell"));
    assert.equal(cells.length, 6);
    const n = Number(text(find(r, cls("fix-satisfies"))).match(/Satisfies (\d)/)[1]);
    assert.equal(cells.filter(cls("unlock-on")).length, n);
    assert.match(text(find(r, cls("fix-satisfied-names"))), /\w/);
  }
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

// Gap report (Milestone 4): every covered authority; gaps grouped mandatory /
// recommended / not yet classified / advisory, each with its suggested change.
function report(st = demo(), opts = {}) {
  const evalState = engine.reportState(DATA, st);
  const all_ = engine.evaluateAll(DATA, evalState);
  const targets = st.targetMarkets.map((k) => engine.reportKeyFor(DATA, k)).filter(Boolean);
  const m = model.build(snap.compact(all_, evalState), LABELS, { targets });
  return view.resultsPage(h, s, m, { labels: LABELS, ...opts });
}

test("fix list: one list, most severe first; each fix has a title, the change, a severity chip and a label tag", () => {
  const page = report();
  const list = find(page, cls("fix-list"));
  const rows = all(find(list, cls("gap-gaps")), cls("fix-row"));
  assert.ok(rows.length >= 3);
  const RANK = { Critical: 0, Significant: 1, Minor: 2 };
  const sev = rows.map((r) => text(find(r, cls("sev-chip"))).replace(/[!\s]/g, ""));
  assert.deepEqual(sev.map((x) => RANK[x]), sev.map((x) => RANK[x]).slice().sort((a, b) => a - b), sev.join(","));
  for (const r of rows) {
    assert.match(text(find(r, cls("fix-title"))), / · /);
    assert.ok(text(find(r, cls("fix-change"))).length > 25, "each gap states its suggested change");
    assert.match(text(find(r, cls("fix-obligation"))), /^(Mandatory|Recommended)( \(draft\))?$|^Not yet classified$/);
    assert.match(text(r), /Satisfies \d of 6 authorities/);
  }
  assert.match(text(list), /Labels marked draft await expert confirmation/);
});

test("fix list: top 3, the rest behind 'Show all'", () => {
  const rooms = DATA.rooms.map((r) => r.id);
  const values = Object.fromEntries(rooms.map((id) => [id, { "HVAC-001": "Unclassified/CNC", "DIM-001": 1 }]));
  const list = find(report(demo({ selectedRooms: rooms, roomValues: values })), cls("gap-gaps"));
  assert.equal(all(find(list, cls("fixes-top")), cls("fix-row")).length, 3);
  const more = find(list, (n) => n.tag === "details" && /Show all \d+ changes/.test(text(find(n, tag("summary")))));
  assert.ok(more);
  assert.equal(find(more, tag("ol")).attrs.start, "4");
});

// Seven gaps: five recommended ones outrank the two mandatory ones.
function mixedList() {
  const SIX = ["schedule_m", "us_fda", "eu_gmp", "who_gmp", "china_nmpa", "japan_pmda"];
  const ids = ["R1", "R2", "R3", "R4", "R5", "M1", "M2"];
  const row = (t) => ({ room: null, param: t, threshold: t, markets: Object.fromEntries(SIX.map((mk) => [mk, { status: mk === "schedule_m" ? "non_compliant" : "not_regulated", fallback: null }])) });
  const m = model.build({ rollup: Object.fromEntries(SIX.map((mk) => [mk, "Partial"])), checklist: [], evaluations: ids.map(row),
    recommendations: ids.map((id) => ({ id, severity: id[0] === "R" ? "Critical" : "Partial", obligation: id[0] === "R" ? "recommended" : "mandatory", change: `Set ${id} to the value every authority requires.` })) }, LABELS);
  return find(view.fixList(h, m, LABELS), cls("gap-gaps"));
}
const rowIds = (n) => all(n, cls("fix-row")).map((r) => text(find(r, cls("fix-change"))).split(" ")[1]);

test("fix list: 'Mandatory only' rebuilds the list from the mandatory changes, announces it, and can be undone", () => {
  const list = mixedList();
  const btn = find(list, (n) => n.tag === "button" && /Mandatory only/.test(text(n)));
  assert.ok(btn, "filter button");
  assert.equal(btn.attrs["aria-pressed"], "false");
  const status = find(list, cls("fix-filter-status"));
  assert.equal(status.attrs.role, "status");
  const ev = { currentTarget: { setAttribute: (k, v) => (btn.attrs[k] = v) } };
  btn.attrs.onclick(ev);
  assert.equal(btn.attrs["aria-pressed"], "true");
  // The two mandatory changes, ranked 6th and 7th overall, now lead a visible list.
  assert.deepEqual(rowIds(find(list, cls("fixes-top"))), ["M1", "M2"]);
  assert.equal(find(list, cls("show-all")), null, "nothing left folded away");
  assert.match(text(find(list, cls("fix-filter-status"))), /Showing 2 mandatory changes/);
  btn.attrs.onclick(ev);
  assert.equal(btn.attrs["aria-pressed"], "false");
  assert.deepEqual(rowIds(find(list, cls("fixes-top"))), ["R1", "R2", "R3"]);
  assert.match(text(find(find(list, cls("show-all")), tag("summary"))), /Show all 7 changes/);
  assert.match(text(find(list, cls("fix-filter-status"))), /Showing all 7 changes/);
});

test("advisory suggestions are a quiet, collapsed group that says it affects no verdict", () => {
  const mkRow = (threshold, status, fallback) => ({ room: null, param: "UTIL-001", threshold, markets: { schedule_m: { status, fallback: fallback || null } } });
  const m = model.build({ rollup: { schedule_m: "Partial" }, checklist: [],
    evaluations: [mkRow("G1", "non_compliant"), mkRow("A1", "not_regulated", "non_compliant")],
    recommendations: [{ id: "G1", severity: "Significant", obligation: "mandatory", change: "Set G1 to the required value for this authority." }, { id: "A1", severity: "Partial", obligation: "unclassified", change: "Set A1 to the international reference value." }] }, LABELS);
  const adv = find(view.resultsPage(h, s, m, { labels: LABELS }), cls("gap-advisory"));
  assert.ok(adv);
  assert.equal(adv.tag, "details");
  assert.equal(adv.attrs.open, undefined);
  assert.match(text(adv), /does not affect/i);
});

test("scorecards cover all six authorities and mark the planner's target markets", () => {
  const page = report(demo({ targetMarkets: ["schedule_m", "pics"] }));
  const cards = all(find(page, cls("scorecards")), cls("scorecard"));
  assert.equal(cards.length, 6);
  const marked = cards.filter((c) => /Your target/.test(text(c))).map((c) => text(c));
  assert.equal(marked.length, 2);
  assert.ok(marked.some((t) => /EU-GMP \/ PIC\/S/.test(t)));
});

// Every room selected, each too small: many rooms with a gap.
const busy = () => {
  const rooms = DATA.rooms.filter((r) => r.applies_to.sterile).map((r) => r.id);
  return demo({ selectedRooms: rooms, roomValues: Object.fromEntries(rooms.map((id) => [id, { "HVAC-001": "Unclassified/CNC", "DIM-001": 1 }])) });
};

test("room grid: scrollable labelled region, glyph + text in cells, capped at 15 rows", () => {
  const page = live(busy());
  const region = find(page, cls("grid-scroll"));
  assert.ok(region.attrs["data-region-label"], "named once it scrolls (syncScrollRegions)");
  const rows = all(find(region, tag("tbody")), tag("tr"));
  assert.ok(rows.length > 15);
  assert.equal(rows.filter((r) => !r.attrs.hidden).length, 15);
  const btn = find(page, (n) => n.tag === "button" && /Show all \d+ rooms/.test(text(n)));
  assert.ok(btn);
  assert.equal(rows[15].children[0].attrs.tabindex, "-1", "the first revealed row can take focus");
  btn.attrs.onclick({ currentTarget: btn });
  assert.equal(rows.filter((r) => r.hidden === false || !r.attrs.hidden).length, rows.length);
  assert.match(text(find(page, cls("grid-count"))), new RegExp(`^Showing all ${rows.length} rooms with a gap\\.$`));
  assert.equal(find(page, (n) => n.attrs.role === "status" && cls("grid-status")(n)), null, "focus is the one announcement");
  const fail = find(region, cls("cell-fail"));
  assert.match(text(fail), /✗/);
  assert.match(text(fail), /not met/);
  rows.forEach((r) => assert.equal(r.children[0].tag, "th"));
});

test("room grid: only rooms with a gap; the rest are named in one line", () => {
  const page = live(demo({ selectedRooms: ["Z-29", "Z-01"] }));
  const grid = find(page, cls("room-grid"));
  const heads = all(find(grid, tag("tbody")), (n) => n.tag === "th").map((n) => text(n));
  assert.ok(heads.some((t) => /Aseptic Filling/.test(t)));
  assert.ok(heads.some((t) => /Facility/.test(t)));
  assert.ok(!heads.some((t) => /Inward Material/.test(t)), heads.join(" | "));
  assert.match(text(find(grid, cls("grid-clear"))), /1 more room has no gap against any covered authority: Inward Material/);
});

test("room grid: failing cells are tinted by their worst severity, said in words too", () => {
  const grid = find(live(), cls("room-grid"));
  const crit = find(grid, cls("cell-worst-critical"));
  assert.ok(crit, "the facility row has a critical gap");
  assert.match(text(crit), /worst critical/);
  assert.ok(find(grid, cls("cell-worst-significant")));
  assert.match(text(find(grid, cls("grid-legend"))), /critical/i);
  for (const c of all(grid, cls("cell-fail"))) assert.ok(["critical", "significant", "partial"].some((k) => cls("cell-worst-" + k)(c)));
});

test("room grid: phone cards list each gap room with the authorities it fails", () => {
  const grid = find(live(), cls("room-grid"));
  const cards = all(find(grid, cls("room-cards")), cls("room-card"));
  assert.equal(cards.length, all(find(grid, tag("tbody")), tag("tr")).length, "one card per grid row");
  const fac = cards.find((c) => /Facility/.test(text(c)));
  assert.match(text(fac), /European Union \(EU-GMP \/ PIC\/S\): 1 not met \(critical\)/, "full names on phones, not abbreviations");
});

test("room grid: no room with a gap shows a plain message, no table", () => {
  const page = live(demo({ facilityValues: {}, roomValues: { "Z-29": { "HVAC-001": "Grade A (ISO 5)" } } }));
  const grid = find(page, cls("room-grid"));
  assert.equal(find(grid, tag("table")), null);
  assert.match(text(grid), /No room has a gap against any covered authority/);
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

test("range charts label the miss: '30 m² short', '2 °C over'", () => {
  const items = all(find(live(), cls("numeric-section")), cls("bullet"));
  const area = items.find((i) => /Area/i.test(text(i)));
  assert.match(text(area), /30 m² short/);
  assert.ok(find(area, (n) => n.ns === "svg" && cls("miss")(n)), "the gap is drawn");
  const temp = items.find((i) => /Temperature/i.test(text(i)));
  assert.match(text(temp), /2 °C over/);
});

test("range charts merge authorities with identical limits into one row", () => {
  const g = [{ id: "m", room: null, roomLabel: "Facility", label: "Pressure", unit: "Pa", entered: 5, conflict: null, fallback: null, state: "fail", severity: "Partial",
    bands: { schedule_m: { min: 10, max: null, status: "non_compliant" }, who_gmp: { min: 10, max: null, status: "non_compliant" }, eu_gmp: { min: 15, max: null, status: "non_compliant" } } }];
  const item = find(view.numericSection(h, s, g, { labels: LABELS }), cls("bullet"));
  const rows = all(item, cls("bullet-row"));
  assert.equal(rows.length, 2);
  assert.match(text(rows.find((r) => /≥ 10/.test(text(r)))), /India \(Schedule M\), WHO GMP \(international\)/);
});

test("range charts invent no edge: a one-sided limit fades out instead of ending", () => {
  const g = [{ id: "o", room: null, roomLabel: "Facility", label: "Pressure", unit: "Pa", entered: 5, conflict: null, fallback: null, state: "fail", severity: "Partial",
    bands: { eu_gmp: { min: 10, max: null, status: "non_compliant" } } }];
  const item = find(view.numericSection(h, s, g, { labels: LABELS }), cls("bullet"));
  const band = find(item, (n) => n.ns === "svg" && cls("band")(n));
  assert.ok(cls("band-open-hi")(band));
  const grad = find(item, (n) => n.tag === "linearGradient");
  assert.ok(grad && band.attrs.fill === `url(#${grad.attrs.id})`);
  assert.ok(cls("band-neutral")(band), "required ranges are neutral; the miss carries the colour");
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
  assert.equal(find(page, cls("severity-matrix")), null, "no empty matrix");
});

test("partial data: no-value count is shown with a note", () => {
  const page = live();
  assert.match(text(page), /needs value/i);
  assert.match(text(page), /not counted as met or not met/i);
  assert.match(text(find(page, cls("completeness"))), /\d+ of \d+ checks have values — this is not a full assessment/);
});

test("everything not covered: never green, says nothing was checked", () => {
  const page = live(demo({ targetMarkets: ["uk_mhra", "sfda"] }));
  assert.equal(find(page, cls("verdict-compliant")), null);
  assert.match(text(find(page, cls("results-verdicts"))), /Not covered/);
  assert.doesNotMatch(text(page), /within each authority's range/, "no false all-clear");
  assert.match(text(find(page, cls("empty-panel"))), /Nothing was checked yet/i);
  assert.equal(find(page, cls("fix-list")), null, "no empty fix list or grid");
  assert.equal(find(page, cls("room-grid")), null);
});

test("no markets / empty model: a message only", () => {
  const page = view.resultsPage(h, s, model.build({ rollup: {} }, LABELS), {});
  assert.match(text(find(page, cls("empty-panel"))), /No results yet/i);
  assert.equal(all(page, (n) => n.tag === "svg").length, 0);
});

test("single market renders without a grid comparison problem", () => {
  const page = live(demo({ targetMarkets: ["eu_gmp"] }));
  assert.equal(all(page, cls("scorecard")).length, 1);
  assert.equal(all(page, cls("verdict-item")).length, 1);
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

// Regions only where a wrapper actually scrolls (Phase 3): views mark every
// scroller with its name; syncScrollRegions() (browser) makes the ones that
// overflow a focusable, named region and leaves the rest alone.
test("scrollers carry their name but are not regions until they overflow", () => {
  const scrollers = all(live(), (n) => cls("table-scroll")(n) || cls("grid-scroll")(n));
  assert.ok(scrollers.length >= 2);
  for (const n of scrollers) {
    assert.ok((n.attrs["data-region-label"] || "").trim(), "name ready for syncScrollRegions");
    assert.equal(n.attrs.role, undefined);
    assert.equal(n.attrs.tabindex, undefined);
  }
});

test("syncScrollRegions: overflowing scrollers become focusable named regions; others stop being regions", () => {
  const el = (scrollWidth, clientWidth) => {
    const attrs = { role: "region", tabindex: "0", "aria-label": "old" };
    return { scrollWidth, clientWidth, attrs, dataset: { regionLabel: "Gaps by room" },
      setAttribute(k, v) { attrs[k] = v; }, removeAttribute(k) { delete attrs[k]; } };
  };
  const wide = el(900, 300), fits = el(300, 300);
  view.syncScrollRegions({ querySelectorAll: () => [wide, fits] });
  assert.deepEqual(wide.attrs, { role: "region", tabindex: "0", "aria-label": "Gaps by room" });
  assert.deepEqual(fits.attrs, {});
});

test("scrollRegion builds the wrapper app.js uses for its detail tables", () => {
  const r = view.scrollRegion(h, "Detailed parameter status", h("table", {}, []));
  assert.deepEqual([r.attrs.class, r.attrs["data-region-label"], r.attrs.role], ["table-scroll", "Detailed parameter status", undefined]);
});

test("every 'View as table' and 'Show all' has a unique name", () => {
  const page = live(busy());
  const names = (re) => all(page, (n) => (n.tag === "summary" || n.tag === "button") && re.test(text(n))).map((n) => text(n).replace(/\s+/g, " ").trim());
  const views = names(/^View as table/);
  assert.ok(views.length >= 2);
  assert.equal(new Set(views).size, views.length, views.join(" | "));
  views.forEach((v) => assert.match(v, /^View as table ?: \S/));
  const shows = names(/^Show all/);
  assert.ok(shows.length >= 2);
  assert.equal(new Set(shows).size, shows.length, shows.join(" | "));
});

test("bars and range charts repeat their numbers in text, so their SVG is hidden from screen readers", () => {
  const page = live();
  for (const svg of all(find(page, cls("scorecards")), (n) => n.ns === "svg" && n.tag === "svg")) assert.equal(svg.attrs["aria-hidden"], "true");
  for (const svg of all(find(page, cls("numeric-section")), (n) => n.ns === "svg" && n.tag === "svg")) assert.equal(svg.attrs["aria-hidden"], "true");
  assert.equal(find(find(page, cls("scorecards")), cls("sc-name")).tag, "h5", "card names sit under the figure's h4");
});

test("authority names come from screen-reader text, never a title tooltip", () => {
  const page = report(demo(), { authority: authorityOpts() });
  assert.deepEqual(all(page, (n) => n.ns === "html" && n.attrs.title !== undefined).map((n) => n.tag), []);
});

test("range charts: a closed limit has a visible edge line; an open side has none", () => {
  const g = [{ id: "o", room: null, roomLabel: "Facility", label: "Pressure", unit: "Pa", entered: 5, conflict: null, fallback: null, state: "fail", severity: "Partial",
    bands: { eu_gmp: { min: 10, max: null, status: "non_compliant" }, us_fda: { min: 10, max: 20, status: "non_compliant" } } }];
  const rows = all(find(view.numericSection(h, s, g, { labels: LABELS }), cls("bullet")), cls("bullet-row"));
  const edges = (r) => all(r, (n) => n.ns === "svg" && cls("band-edge")(n)).length;
  assert.equal(edges(rows.find((r) => /United States/.test(text(r)))), 2);
  assert.equal(edges(rows.find((r) => /European Union/.test(text(r)))), 1);
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
  for (const c of cells) assert.match(text(c), /^(✓ Met|✗ Not met|– No rule set|\? Needs value)$/);
});

test("authorityView: the switcher offers the chosen authorities and marks the current one", () => {
  const sec = view.authorityView(h, authorityOpts("us_fda"));
  const buttons = all(sec, (n) => n.tag === "button" && n.attrs["aria-pressed"] !== undefined);
  assert.deepEqual(buttons.map((b) => [text(b).trim(), b.attrs["aria-pressed"]]),
    ["schedule_m", "us_fda", "eu_gmp", "who_gmp"].map((k) => [LABELS.market(k), String(k === "us_fda")]));
});

test("evidence tables: one <details> per room with status counts; rooms with failures open; rows without a result folded", () => {
  const sec = view.authorityView(h, authorityOpts());
  const rooms = all(sec, cls("auth-room"));
  assert.ok(rooms.length >= 2);
  for (const r of rooms) {
    assert.equal(r.tag, "details");
    const summary = text(find(r, tag("summary")));
    const hasFail = all(r, cls("st-fail")).length > 0;
    assert.equal(r.attrs.open === "open", hasFail, summary);
    assert.match(summary, /\d+ (not met|met|needs value|no rule set)/);
  }
  const folded = all(sec, cls("auth-folded"));
  assert.ok(folded.length > 0, "needs-value / no-rule rows are folded away");
  for (const f of folded) {
    assert.equal(f.tag, "details");
    for (const row of all(f, cls("auth-row"))) assert.ok(cls("st-no_value")(row) || cls("st-not_covered")(row));
  }
  for (const r of rooms) {
    const open = r.children.filter((c) => typeof c !== "string" && !cls("auth-folded")(c));
    for (const row of all({ attrs: {}, children: open }, cls("auth-row"))) assert.ok(cls("st-fail")(row) || cls("st-pass")(row));
  }
});

test("with nothing to compare, only the empty panel and the authority section show", () => {
  const page = view.resultsPage(h, s, model.build({ rollup: {} }, LABELS), { authority: authorityOpts() });
  assert.ok(find(page, cls("empty-panel")));
  assert.ok(find(page, cls("auth-view")), "the authority section still shows");
});

test("authorityView notes are short enough for a phone column", () => {
  for (const n of all(view.authorityView(h, authorityOpts()), cls("auth-note"))) assert.ok(text(n).length <= 60, text(n));
});

test("wording reflects that every covered authority is compared", () => {
  const t = text(report(demo({ roomValues: {}, facilityValues: {} })));
  assert.doesNotMatch(t, /selected authorit/i);
});

test("each gap on screen shows its label and source; the page states the benchmark data date", () => {
  const page = report(demo(), { dataDate: "2026-11-24" });
  for (const it of all(page, cls("fix-row"))) {
    assert.match(text(find(it, cls("fix-obligation"))), /^(Mandatory|Recommended)( \(draft\))?$|^Not yet classified$|^Advisory \(international standard\)$/);
    assert.match(text(find(it, cls("fix-source"))), /^Source: .{3,}/);
  }
  assert.match(text(find(page, cls("data-date"))), /Benchmark data as of 24 Nov 2026/);
});
