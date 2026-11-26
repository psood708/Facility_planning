/* Step 4 results page — charts built from ResultsModel output. Pure: every
 * function takes the DOM builders h() (HTML) and s() (SVG) as its first
 * arguments, so each state is unit-testable without a DOM.
 *
 * Rules (accessibility review + strict CSP):
 *  - every chart is a <figure> with a <figcaption> (title + takeaway); each
 *    SVG is role="img" with <title>/<desc> and aria-labelledby; a visible
 *    "View as table" <details> holds the real numbers;
 *  - colour is never alone: a swatch or mark always sits beside a glyph and
 *    a word; text is in ink colours, never the status colour;
 *  - no SVG text (labels live in HTML), no inline styles (CSS classes only),
 *    SVG geometry uses percentages so it never has to be measured;
 *  - every word people read comes from ResultsModel.VOCAB, shared with the
 *    exported report (results redesign, Phase 1).
 * Browser: window.ResultsView; Node: module.exports.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod;
  else root.ResultsView = mod;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const RM = typeof ResultsModel !== "undefined" ? ResultsModel : require("./results-model.js");
  const V = RM.VOCAB;
  const lower = (w) => w.charAt(0).toLowerCase() + w.slice(1);

  // Shared status glyphs (the status pills elsewhere use the same set).
  const GLYPH = { compliant: "✓", non_compliant: "✗", no_value: "?", not_regulated: "–", not_covered: "⊘", no_rule: "–" };
  const STATUS_WORD = Object.fromEntries(Object.entries(V.status).map(([k, w]) => [k, lower(w)]));
  STATUS_WORD.no_rule = lower(V.status.not_regulated);
  // "No rule set" covers both "the authority sets no figure" and "no data".
  const VERDICT_GLYPH = { compliant: "✓", partial: "!", non_compliant: "✗", insufficient: "?", not_covered: "⊘" };
  const VERDICT = Object.fromEntries(Object.keys(VERDICT_GLYPH).map((k) => [k, { glyph: VERDICT_GLYPH[k], word: V.verdict[k] }]));
  const SEVERITIES = ["Critical", "Significant", "Partial"];
  const SEV_GLYPH = { Critical: "!!!", Significant: "!!", Partial: "!" };
  const sevWord = RM.severityWord;
  const CELL = {
    fail: { glyph: "✗", word: STATUS_WORD.non_compliant },
    pass: { glyph: "✓", word: STATUS_WORD.compliant },
    empty: { glyph: "?", word: STATUS_WORD.no_value },
    na: { glyph: "–", word: STATUS_WORD.not_regulated },
  };
  const SHORT = {
    schedule_m: "Sch M", us_fda: "FDA", eu_gmp: "EU", uk_mhra: "MHRA", pics: "PIC/S", who_gmp: "WHO",
    tga_australia: "TGA", china_nmpa: "NMPA", japan_pmda: "PMDA", sahpra: "SAHPRA", sfda: "SFDA",
  };
  const FIX_LIMIT = 3;
  const ROOM_LIMIT = 15;
  const NUMERIC_LIMIT = 12;

  // Counter-based ids: unique across any number of renders on one page.
  let uid = 0;
  const nextId = (p) => `rv-${p}-${++uid}`;

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;
  const pct = (v) => `${Math.round(Math.min(100, Math.max(0, v)) * 1000) / 1000}%`;
  const fmtNum = (v) => String(Math.round(v * 100) / 100);
  const short = (mk) => SHORT[mk] || String(mk).toUpperCase();
  // Country-first names ("China (NMPA)") wherever a market is named in text.
  const marketName = (labels, mk) => (Object.prototype.hasOwnProperty.call(V.place, mk) ? V.place[mk] : null) ||
    (labels && typeof labels.market === "function" && labels.market(mk)) || String(mk);
  const unitText = (u) => (u ? " " + u : "");
  function boundText(min, max, unit) {
    if (min !== null && max !== null) return `${fmtNum(min)}–${fmtNum(max)}${unitText(unit)}`;
    if (min !== null) return `≥ ${fmtNum(min)}${unitText(unit)}`;
    if (max !== null) return `≤ ${fmtNum(max)}${unitText(unit)}`;
    return "no number";
  }
  const enteredText = (e, unit) =>
    (typeof e === "object" && e !== null ? `${e.min === null ? "?" : fmtNum(e.min)}–${e.max === null ? "?" : fmtNum(e.max)}` : fmtNum(e)) + unitText(unit);

  // ------------------------------------------------------------ primitives

  const glyph = (h, g, extra) => h("span", { class: "glyph" + (extra ? " " + extra : ""), "aria-hidden": "true" }, g);
  const srOnly = (h, t) => h("span", { class: "sr-only" }, t);
  // Long room names ("Filling (Vials/Ampoules/PFS)") may wrap after a slash.
  const breakable = (h, t) => String(t).split("/").flatMap((part, i) => (i ? [h("wbr", {}), "/" + part] : [part]));

  function legendItem(h, swatchClass, g, label) {
    return h("li", { class: "legend-item" }, [h("span", { class: "swatch " + swatchClass, "aria-hidden": "true" }), glyph(h, g), h("span", { class: "legend-text" }, label)]);
  }

  function chartSvg(s, { title, desc, height, className }, marks) {
    const t = nextId("title");
    const d = nextId("desc");
    return s("svg", { class: "chart " + className, role: "img", "aria-labelledby": `${t} ${d}`, width: "100%", height: String(height), focusable: "false" },
      [s("title", { id: t }, title), s("desc", { id: d }, desc)].concat(marks));
  }

  // Diagonal hatch for "advisory" and "not covered" fills (CVD/print/forced colours).
  function hatch(s, id, kind) {
    return s("pattern", { id, patternUnits: "userSpaceOnUse", width: "6", height: "6", patternTransform: "rotate(45)" }, [
      s("rect", { x: "0", y: "0", width: "6", height: "6", class: "hatch-bg hatch-bg-" + kind }),
      s("rect", { x: "0", y: "0", width: "2", height: "6", class: "hatch-line hatch-line-" + kind }),
    ]);
  }

  // Segmented bar: rounded outer ends (clip), 2px surface gap between segments.
  function segmentedBar(s, segments, { title, desc, height = 12, className = "" }) {
    const total = segments.reduce((a, x) => a + x.value, 0);
    const clip = nextId("clip");
    const pat = nextId("hatch");
    const defs = s("defs", {}, [
      s("clipPath", { id: clip }, s("rect", { x: "0", y: "0", width: "100%", height: String(height), rx: "4", ry: "4" })),
      hatch(s, pat, "neutral"),
    ]);
    const marks = [];
    if (!total) {
      marks.push(s("rect", { x: "0", y: "0", width: "100%", height: String(height), class: "seg seg-empty" }));
    } else {
      let x = 0;
      const shown = segments.filter((x_) => x_.value > 0);
      shown.forEach((seg) => {
        const w = (seg.value / total) * 100;
        marks.push(s("rect", { x: pct(x), y: "0", width: pct(w), height: String(height), class: "seg " + seg.cls, fill: seg.hatched ? `url(#${pat})` : null }));
        x += w;
      });
      x = 0;
      shown.slice(0, -1).forEach((seg) => {
        x += (seg.value / total) * 100;
        marks.push(s("rect", { x: pct(x), y: "0", width: "2", height: String(height), transform: "translate(-1 0)", class: "seg-gap" }));
      });
    }
    return chartSvg(s, { title, desc, height, className: "bar " + className }, [defs, s("g", { "clip-path": `url(#${clip})` }, marks)]);
  }

  // A wrapper that may scroll sideways must be keyboard-reachable and named
  // (WCAG 2.1.1; axe "scrollable-region-focusable").
  const scrollRegion = (h, label, child) => h("div", { class: "table-scroll", role: "region", tabindex: "0", "aria-label": label }, child);

  function tableView(h, caption, head, rows) {
    return h("details", { class: "table-view" }, [
      h("summary", {}, "View as table"),
      scrollRegion(h, caption, h("table", { class: "results-table data-table" }, [
        h("caption", {}, caption),
        h("thead", {}, h("tr", {}, head.map((c) => h("th", { scope: "col" }, c)))),
        h("tbody", {}, rows.map((r) => h("tr", {}, [h("th", { scope: "row" }, r[0])].concat(r.slice(1).map((c) => h("td", {}, String(c))))))),
      ])),
    ]);
  }

  const figure = (h, className, title, takeaway, body) =>
    h("figure", { class: "rv-figure " + className }, [
      h("figcaption", {}, [h("span", { class: "fig-title" }, title), takeaway ? h("span", { class: "fig-takeaway" }, takeaway) : null]),
    ].concat(body));

  // ------------------------------------------------------------ verdict per market

  // Authority × severity matrix (results redesign, Phase 2): one row per
  // market in verdict order, gaps counted by severity. It is a real table,
  // so the numbers are the chart; cells are tinted by severity only when
  // they hold a gap, and always carry a glyph and the count.
  function severityMatrix(h, model) {
    const sev = model.severity;
    if (!sev.total) return null;
    const byKey = new Map(model.markets.map((m) => [m.key, m]));
    const rows = model.verdicts.map((v) => {
      const m = byKey.get(v.key);
      const head = h("th", { scope: "row" }, [h("span", { class: "mx-place" }, m.place), v.target ? h("span", { class: "target-badge" }, "Your target") : null]);
      if (m.verdictKey === "not_covered") return h("tr", { class: "mx-row mx-quiet" }, [head, h("td", { class: "mx-note", colspan: "3" }, "Not covered by this dataset")]);
      if (!m.checked) return h("tr", { class: "mx-row mx-quiet" }, [head, h("td", { class: "mx-note", colspan: "3" }, "Nothing checked yet")]);
      return h("tr", { class: "mx-row" }, [head].concat(SEVERITIES.map((k) => {
        const n = m.gapsBySeverity[k];
        const key = k.toLowerCase();
        return h("td", { class: `mx-cell mx-${key}` + (n ? "" : " mx-zero") }, n
          ? [h("span", { class: "swatch sw-sev-" + key, "aria-hidden": "true" }), glyph(h, SEV_GLYPH[k]), h("span", { class: "mx-count" }, String(n))]
          : "0");
      })));
    });
    const takeaway = sev.Critical
      ? `${sev.Critical} of ${plural(sev.total, "change")} ${sev.Critical === 1 ? "is" : "are"} critical — fix ${sev.Critical === 1 ? "it" : "these"} first.`
      : `None of the ${plural(sev.total, "change")} is critical.`;
    return figure(h, "severity-matrix", "Gaps by authority and severity", takeaway, [
      scrollRegion(h, "Gaps by authority and severity", h("table", { class: "mx-table" }, [
        h("caption", {}, "Gaps by authority and severity (one change can close a gap for several authorities)"),
        h("thead", {}, h("tr", {}, [h("th", { scope: "col" }, "Authority")].concat(SEVERITIES.map((k) => h("th", { scope: "col" }, sevWord(k)))))),
        h("tbody", {}, rows),
      ])),
    ]);
  }

  // The answer first: one plain line per market (targets first), how much of
  // the facility was actually checked, and how many changes are needed.
  function verdictSection(h, s, model, { stale } = {}) {
    const id = nextId("verdicts");
    return h("section", { class: "results-verdicts", "aria-labelledby": id }, [
      h("p", { class: "hero-kicker" }, stale ? "Read-only · as saved" : "Summary"),
      h("h3", { id }, "Verdict by market"),
      h("ul", { class: "verdict-list" }, model.verdicts.map((v) => h("li", { class: "verdict-item verdict-" + v.verdictKey }, [
        glyph(h, VERDICT_GLYPH[v.verdictKey] || "?", "verdict-glyph"),
        h("span", { class: "verdict-place" }, v.place),
        v.target ? h("span", { class: "target-badge" }, "Your target") : null,
        h("span", { class: "verdict-word" }, v.word),
        h("span", { class: "verdict-detail" }, v.detail),
      ]))),
      h("p", { class: "completeness" }, RM.completenessText(model)),
      h("p", { class: "headline" }, RM.fixSummary(model)),
      severityMatrix(h, model),
    ]);
  }

  function emptyPanel(h, title, body) {
    const id = nextId("empty");
    return h("section", { class: "empty-panel", "aria-labelledby": id }, [h("h3", { id }, title), h("p", {}, body)]);
  }

  // ------------------------------------------------------------ scorecards

  function scorecard(h, s, m) {
    const v = VERDICT[m.verdictKey] || VERDICT.insufficient;
    const head = h("div", { class: "sc-head" }, [
      h("h4", { class: "sc-name" }, m.place),
      m.target ? h("span", { class: "target-badge" }, "Your target") : null,
      h("span", { class: "verdict-badge verdict-" + m.verdictKey }, [glyph(h, v.glyph), h("span", { class: "verdict-word" }, v.word)]),
    ]);
    if (m.verdictKey === "not_covered") {
      return h("li", { class: "scorecard sc-not_covered" }, [
        head,
        segmentedBar(s, [{ value: 1, cls: "st-not_covered", hatched: true }], { title: `${m.place}: not covered`, desc: "This dataset has no requirements for this authority; nothing was checked.", className: "status-bar" }),
        h("p", { class: "sc-met" }, "Nothing checked"),
        h("p", { class: "sc-note" }, `This dataset has no requirements for ${m.place}, so nothing was checked. This is not a pass.`),
      ]);
    }
    // The bar counts checked values only (met / not met); checks that need a
    // value or have no rule are said in words beside it, never drawn.
    const c = m.counts;
    const present = ["compliant", "non_compliant"].filter((k) => c[k]);
    const desc = m.checked ? present.map((k) => `${c[k]} ${STATUS_WORD[k]}`).join(", ") + "." : "No value has been checked against this authority yet.";
    const noRule = c.not_regulated + c.not_covered;
    const unchecked = [c.no_value ? `${c.no_value} ${c.no_value === 1 ? "needs" : "need"} a value` : null, noRule ? `${noRule} ${STATUS_WORD.no_rule}` : null].filter(Boolean).join(" · ");
    const gaps = SEVERITIES.filter((k) => m.gapsBySeverity[k]);
    return h("li", { class: "scorecard sc-" + m.verdictKey }, [
      head,
      segmentedBar(s, ["compliant", "non_compliant"].map((k) => ({ value: c[k], cls: "st-" + k })), { title: m.checked ? `${m.place}: ${m.met} of ${m.checked} checked values met` : `${m.place}: nothing checked yet`, desc, className: "status-bar" }),
      h("p", { class: "sc-met" }, [h("strong", {}, m.checked ? `${m.met} of ${plural(m.checked, "check")} met` : "Nothing checked yet")]),
      present.length ? h("ul", { class: "legend sc-legend" }, present.map((k) => legendItem(h, "sw-" + k, GLYPH[k], `${c[k]} ${STATUS_WORD[k]}`))) : null,
      unchecked ? h("p", { class: "sc-unchecked" }, unchecked) : null,
      h("p", { class: "sc-gaps" }, gaps.length
        ? [h("span", {}, "Gaps:")].concat(gaps.map((k, i) => h("span", { class: "sc-gap" }, [h("span", { class: "swatch sw-sev-" + k.toLowerCase(), "aria-hidden": "true" }), `${m.gapsBySeverity[k]} ${sevWord(k).toLowerCase()}${i < gaps.length - 1 ? "," : ""}`])))
        : m.checked ? "No gaps against this authority." : "No checks with a value yet."),
    ]);
  }

  function scorecards(h, s, model) {
    const withNoValue = model.markets.filter((m) => m.counts.no_value).length;
    const worst = model.markets.filter((m) => m.verdictKey === "non_compliant").map((m) => m.place);
    const takeaway = worst.length
      ? `${worst.join(", ")} ${worst.length === 1 ? "has" : "have"} at least one critical gap.`
      : model.markets.some((m) => m.verdictKey === "partial") ? "No critical gaps; some authorities have gaps to close." : "One strip per authority.";
    const c = (m, k) => (k === "no_rule" ? m.counts.not_regulated + m.counts.not_covered : m.counts[k]);
    return h("section", { class: "scorecards" }, [
      h("h3", {}, "By authority"),
      figure(h, "scorecard-figure", "How the facility performs against each authority", takeaway, [
        h("ul", { class: "scorecard-list" }, model.markets.map((m) => scorecard(h, s, m))),
        h("p", { class: "chart-note" }, `The verdict is set by the worst gap severity, not by the bar: any critical gap makes it ${V.verdict.non_compliant}; any other gap means it ${lower(V.verdict.partial)}. The bar counts checked values only: met and not met.` +
          (withNoValue ? " Checks that need a value are not counted as met or not met." : "") +
          " International-standard (advisory) results never count toward an authority's verdict."),
        tableView(h, "Checks by authority",
          ["Authority", "Verdict", V.status.compliant, V.status.non_compliant, V.status.no_value, V.status.not_regulated].concat(SEVERITIES.map((k) => `${sevWord(k)} gaps`)),
          model.markets.map((m) => [m.place, (VERDICT[m.verdictKey] || VERDICT.insufficient).word, c(m, "compliant"), c(m, "non_compliant"), c(m, "no_value"), c(m, "no_rule")].concat(SEVERITIES.map((k) => m.gapsBySeverity[k])))),
      ]),
    ]);
  }

  // ------------------------------------------------------------ fixes

  // One fix: severity and label tag, a short title, the full suggested
  // change, how many authorities it satisfies, and its source as a footnote.
  // covered: the covered authorities' keys, one strip cell each.
  function fixItem(h, f, labels, covered) {
    const sev = f.severity.toLowerCase();
    const keys = covered && covered.length ? covered : f.marketsFailing;
    // The strip is a picture of the words beside it, so screen readers get the words.
    const markets = [
      h("span", { class: "unlock-strip", "aria-hidden": "true" }, keys.map((mk) => h("span", {
        class: "unlock-cell" + (f.marketsFailing.includes(mk) ? " unlock-on" : "") + (f.basis === "fallback" ? " unlock-advisory" : ""),
      }, short(mk)))),
      h("span", { class: "sr-only fix-satisfied-names" }, ": " + f.marketsFailing.map((mk) => marketName(labels, mk)).join(", ")),
    ];
    const source = Array.isArray(f.sources) ? h("p", { class: "fix-source" }, "Source: " + (f.sources.length ? f.sources.join("; ") : "No source recorded")) : null;
    return h("li", { class: "fix fix-row fix-" + f.basis + " fix-sev-" + sev + (f.mandatory ? " fix-mandatory" : "") }, [
      h("div", { class: "fix-head" }, [
        h("span", { class: "sev-chip" }, [h("span", { class: "swatch sw-sev-" + sev, "aria-hidden": "true" }), glyph(h, SEV_GLYPH[f.severity]), sevWord(f.severity)]),
        h("span", { class: "fix-obligation ob-" + f.group }, f.labelText || ""),
      ]),
      h("p", { class: "fix-title" }, f.title || `${f.label} · ${f.roomLabel}`),
      h("p", { class: "fix-change" + (f.change ? "" : " fix-change-missing") }, f.change || "Re-evaluate with current data to see the suggested change."),
      h("div", { class: "fix-meta" }, f.basis === "authority"
        ? [h("span", { class: "fix-satisfies" }, `Satisfies ${f.satisfies} of ${plural(f.of, "authority", "authorities")}`)].concat(markets)
        : [h("span", { class: "fix-satisfies" }, "International standard only — misses it for")].concat(markets)),
      source,
    ]);
  }


  // The ranked list: top 3, the rest behind "Show all", and a "Mandatory
  // only" filter when the list mixes mandatory and other gaps.
  // Swap a built node's children: the real DOM in the browser, the plain
  // objects h() returns in unit tests.
  const setKids = (node, kids) => {
    if (typeof node.replaceChildren === "function") node.replaceChildren(...kids);
    else node.children = kids;
  };

  // The ranked list: top 3, the rest behind "Show all", and a "Mandatory
  // only" filter when the list mixes mandatory and other gaps. Filtering
  // rebuilds the list from the matching changes (so they lead it, numbered
  // from 1) and announces how many are shown.
  function rankedList(h, fixes, labels, covered) {
    const lists = (subset, noun) => {
      const rows = subset.map((f) => fixItem(h, f, labels, covered));
      return [
        h("ol", { class: "fixes fixes-top" }, rows.slice(0, FIX_LIMIT)),
        rows.length > FIX_LIMIT ? h("details", { class: "show-all" }, [
          h("summary", {}, `Show all ${rows.length} ${noun}`),
          h("ol", { class: "fixes fixes-more", start: String(FIX_LIMIT + 1) }, rows.slice(FIX_LIMIT)),
        ]) : null,
      ].filter(Boolean);
    };
    const holder = h("div", { class: "fix-lists" }, lists(fixes, "changes"));
    if (!(fixes.some((f) => f.mandatory) && fixes.some((f) => !f.mandatory))) return h("div", { class: "gap-group gap-gaps" }, [holder]);
    const status = h("p", { class: "sr-only fix-filter-status", role: "status" }, "");
    let on = false;
    const button = h("button", {
      type: "button", class: "secondary small fix-filter", "aria-pressed": "false",
      onclick: (e) => {
        on = !on;
        const subset = on ? fixes.filter((f) => f.mandatory) : fixes;
        setKids(holder, lists(subset, on ? "mandatory changes" : "changes"));
        setKids(status, [on ? `Showing ${plural(subset.length, "mandatory change")}.` : `Showing all ${plural(subset.length, "change")}.`]);
        if (e && e.currentTarget) e.currentTarget.setAttribute("aria-pressed", String(on));
      },
    }, "Mandatory only");
    return h("div", { class: "gap-group gap-gaps" }, [button, status, holder]);
  }

  // Cross-authority fix list: one list ranked by severity (results redesign),
  // the legal label as a tag; advisory suggestions in a quiet group after it.
  function fixList(h, model, labels) {
    const groups = model.gapGroups || [];
    const main = (groups.find((g) => g.key === "gaps") || { fixes: [] }).fixes;
    const advisory = groups.find((g) => g.key === "advisory") || { label: "", fixes: [] };
    const covered = model.markets.filter((m) => m.verdictKey !== "not_covered").map((m) => m.key);
    const body = [h("h3", {}, "What to fix first")];
    if (!main.length) {
      const checked = model.markets.some((m) => m.checked);
      body.push(checked
        ? h("p", { class: "positive-note" }, [glyph(h, "✓", "glyph-ok"), RM.fixSummary(model)])
        : h("p", { class: "section-lede" }, RM.fixSummary(model)));
    } else {
      body.push(h("p", { class: "section-lede" }, RM.NOTES.order));
      if (main.some((f) => f.draft)) body.push(h("p", { class: "chart-note fix-draft-note" }, RM.NOTES.draft));
      body.push(rankedList(h, main, labels, covered));
    }
    if (advisory.fixes.length) {
      body.push(h("details", { class: "gap-group gap-advisory" }, [
        h("summary", {}, `${advisory.label} (${advisory.fixes.length})`),
        h("p", { class: "section-lede" }, RM.NOTES.advisory),
        h("ol", { class: "fixes" }, advisory.fixes.map((f) => fixItem(h, f, labels, covered))),
      ]));
    }
    return h("section", { class: "fix-list" }, body);
  }

  // ------------------------------------------------------------ room grid

  // Room × authority grid (Phase 2): only rooms with a gap, failing cells
  // tinted by their worst severity (said in words too), rooms without a gap
  // named in one line. Phones get one card per room instead of the table.
  function roomGrid(h, model) {
    const markets = model.markets;
    const gapRooms = model.rooms.filter((r) => r.failTotal > 0);
    const clear = model.rooms.filter((r) => !r.failTotal);
    if (!gapRooms.length) {
      return h("section", { class: "room-grid" }, [
        h("h3", {}, "Room by authority"),
        h("p", { class: "positive-note" }, [glyph(h, "✓", "glyph-ok"), "No room has a gap against any covered authority."]),
      ]);
    }
    const capped = (i) => i >= ROOM_LIMIT;
    const rows = gapRooms.map((r, i) => h("tr", { class: capped(i) ? "row-extra" : null, hidden: capped(i) ? "hidden" : null }, [
      h("th", { scope: "row" }, breakable(h, r.label)),
    ].concat(markets.map((m) => {
      const c = r.cells[m.key] || { state: "na", fails: 0, worst: null };
      const k = CELL[c.state] || CELL.na;
      if (c.state !== "fail") return h("td", { class: "cell cell-" + c.state }, [glyph(h, k.glyph), srOnly(h, ` ${k.word}`)]);
      const worst = (c.worst || "Partial").toLowerCase();
      return h("td", { class: `cell cell-fail cell-worst-${worst}` }, [
        glyph(h, k.glyph),
        h("span", { class: "cell-count" }, String(c.fails)),
        srOnly(h, ` ${c.fails} not met, worst ${sevWord(c.worst).toLowerCase()}`),
      ]);
    }))));
    const cards = gapRooms.map((r, i) => h("li", { class: "room-card", hidden: capped(i) ? "hidden" : null }, [
      h("p", { class: "room-card-name" }, r.label),
      h("ul", { class: "room-card-gaps" }, markets.filter((m) => (r.cells[m.key] || {}).state === "fail").map((m) => {
        const c = r.cells[m.key];
        return h("li", { class: "cell-worst-" + (c.worst || "Partial").toLowerCase() }, [glyph(h, "✗"), `${m.place}: ${c.fails} not met (${sevWord(c.worst).toLowerCase()})`]);
      })),
    ]));
    const top = gapRooms[0];
    const takeaway = `${top.label} has the most gaps (${top.failTotal} across all authorities).`;
    const extra = gapRooms.length - ROOM_LIMIT;
    const showAll = extra > 0
      ? h("button", { type: "button", class: "secondary small show-rows", onclick: (e) => {
          rows.concat(cards).forEach((r) => { r.hidden = false; });
          if (e && e.currentTarget) e.currentTarget.hidden = true;
        } }, `Show all ${gapRooms.length} rooms`)
      : null;
    const legend = SEVERITIES.map((k) => legendItem(h, "sw-cell-worst-" + k.toLowerCase(), "✗", `not met, worst ${sevWord(k).toLowerCase()} (count of gaps)`))
      .concat(["pass", "empty", "na"].map((k) => legendItem(h, "sw-cell-" + k, CELL[k].glyph, CELL[k].word)));
    return h("section", { class: "room-grid" }, [
      h("h3", {}, "Room by authority"),
      figure(h, "grid-figure", "Where the gaps are", takeaway, [
        h("ul", { class: "legend grid-legend" }, legend),
        h("div", { class: "grid-scroll", role: "region", tabindex: "0", "aria-label": "Rooms with a gap, by authority — scrolls sideways on small screens" },
          h("table", { class: "room-table" }, [
            h("caption", {}, "Rooms with a gap, by authority"),
            h("thead", {}, h("tr", {}, [h("th", { scope: "col" }, "Room / area")].concat(markets.map((m) => h("th", { scope: "col", title: m.place }, [h("span", { "aria-hidden": "true" }, short(m.key)), srOnly(h, m.place)]))))),
            h("tbody", {}, rows),
          ])),
        h("ul", { class: "room-cards" }, cards),
        extra > 0 ? h("p", { class: "chart-note" }, `Showing ${ROOM_LIMIT} of ${gapRooms.length} rooms with a gap.`) : null,
        showAll,
        clear.length ? h("p", { class: "chart-note grid-clear" }, `${plural(clear.length, "more room")} ${clear.length === 1 ? "has" : "have"} no gap against any covered authority: ${clear.map((r) => r.label).join(", ")}.`) : null,
      ]),
    ]);
  }

  // ------------------------------------------------------------ numeric bullets

  function domainOf(g) {
    const bounds = [];
    const bandsShown = Object.values(g.bands).filter((b) => b.status === "compliant" || b.status === "non_compliant");
    bandsShown.forEach((b) => [b.min, b.max].forEach((v) => v !== null && bounds.push(v)));
    if (g.fallback) [g.fallback.min, g.fallback.max].forEach((v) => v !== null && bounds.push(v));
    const vals = (typeof g.entered === "object" ? [g.entered.min, g.entered.max] : [g.entered]).filter((v) => v !== null);
    if (!bounds.length) return null;
    const bmin = Math.min(...bounds), bmax = Math.max(...bounds);
    const span = bmax - bmin || Math.abs(bmax) * 0.5 || 1;
    let lo = bmin - span * 0.5, hi = bmax + span * 0.5;
    const near = (v) => v >= bmin - span * 2 && v <= bmax + span * 2;
    // Keep in-range entered values off the very edge so their marker stays visible.
    vals.filter(near).forEach((v) => { if (v < lo + span * 0.1) lo = v - span * 0.2; if (v > hi - span * 0.1) hi = v + span * 0.2; });
    if (bmin >= 0 && vals.every((v) => v >= 0)) lo = Math.max(lo, 0);
    // Round the axis ends to a readable step (e.g. 16–25 rather than 16–24.8).
    const step = Math.pow(10, Math.floor(Math.log10(hi - lo)) - 1) * 5;
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    return { lo, hi, x: (v) => ((v - lo) / (hi - lo)) * 100, offScale: vals.filter((v) => v < lo || v > hi) };
  }

  // How far an entered value misses a band: [{ from, to, text }] (empty when
  // it is inside). "30 m² short" below a minimum, "2 °C over" above a maximum.
  function missesOf(band, entered, unit) {
    const out = [];
    const lo = typeof entered === "object" ? entered.min : entered;
    const hi = typeof entered === "object" ? entered.max : entered;
    if (band.min !== null && lo !== null && lo < band.min) out.push({ from: lo, to: band.min, text: `${fmtNum(band.min - lo)}${unitText(unit)} short` });
    if (band.max !== null && hi !== null && hi > band.max) out.push({ from: band.max, to: hi, text: `${fmtNum(hi - band.max)}${unitText(unit)} over` });
    return out;
  }

  // One requirement band on the shared axis. The band is neutral (it is the
  // rule, not a verdict); the miss between the value and the limit carries
  // the colour. A one-sided limit fades out on its open side instead of
  // drawing an edge the authority never set.
  function bulletSvg(s, d, band, entered, { title, desc, fallback, misses }) {
    const marks = [s("rect", { x: "0", y: "9", width: "100%", height: "2", class: "bullet-track" })];
    const defs = [];
    const pat = nextId("hatch");
    if (fallback) defs.push(hatch(s, pat, "fallback"));
    const lo = band.min === null ? d.lo : Math.max(band.min, d.lo);
    const hi = band.max === null ? d.hi : Math.min(band.max, d.hi);
    const open = band.min === null ? "lo" : band.max === null ? "hi" : null;
    let fill = fallback ? `url(#${pat})` : null;
    if (open && !fallback) {
      const grad = nextId("fade");
      const solid = { offset: "0%", class: "band-stop", "stop-opacity": "1" };
      const keep = { offset: "35%", class: "band-stop", "stop-opacity": "1" };
      const gone = { offset: "100%", class: "band-stop", "stop-opacity": "0" };
      // Fades towards the open side: right for "at least", left for "at most".
      defs.push(s("linearGradient", { id: grad, x1: open === "hi" ? "0" : "1", x2: open === "hi" ? "1" : "0", y1: "0", y2: "0" }, [s("stop", solid), s("stop", keep), s("stop", gone)]));
      fill = `url(#${grad})`;
    }
    if (defs.length) marks.unshift(s("defs", {}, defs));
    if (hi > lo) {
      marks.push(s("rect", {
        x: pct(d.x(lo)), y: "3", width: pct(d.x(hi) - d.x(lo)), height: "14", rx: open ? "0" : "3",
        class: "band " + (fallback ? "band-fallback" : "band-neutral") + (open ? " band-open-" + open : ""), fill,
      }));
    }
    const clampX = (v) => Math.min(100, Math.max(0, d.x(v)));
    (misses || []).forEach((m) => {
      const a = clampX(Math.min(m.from, m.to)), b = clampX(Math.max(m.from, m.to));
      if (b > a) marks.push(s("rect", { x: pct(a), y: "7", width: pct(b - a), height: "6", class: "miss" + (fallback ? " miss-advisory" : "") }));
    });
    const off = (v) => v < d.lo || v > d.hi;
    if (typeof entered === "object") {
      const a = entered.min === null ? null : entered.min, b = entered.max === null ? null : entered.max;
      if (a !== null && b !== null) marks.push(s("rect", { x: pct(clampX(a)), y: "9", width: pct(clampX(b) - clampX(a)), height: "2", class: "marker-range" }));
      [a, b].filter((v) => v !== null).forEach((v) => marks.push(s("line", { x1: pct(clampX(v)), x2: pct(clampX(v)), y1: "1", y2: "19", class: "marker" + (off(v) ? " marker-off" : "") })));
    } else {
      marks.push(s("line", { x1: pct(clampX(entered)), x2: pct(clampX(entered)), y1: "1", y2: "19", class: "marker" + (off(entered) ? " marker-off" : "") }));
    }
    return chartSvg(s, { title, desc, height: 20, className: "bullet-svg" }, marks);
  }

  function bulletItem(h, s, g, labels) {
    const d = domainOf(g);
    const entered = enteredText(g.entered, g.unit);
    // Authorities with the same limit and result share one row.
    const groups = new Map();
    Object.entries(g.bands).filter(([, b]) => b.status === "compliant" || b.status === "non_compliant").forEach(([mk, b]) => {
      const k = `${b.min}|${b.max}|${b.status}`;
      if (!groups.has(k)) groups.set(k, { band: b, names: [] });
      groups.get(k).names.push(marketName(labels, mk));
    });
    const notSpecified = Object.entries(g.bands).filter(([, b]) => b.status === "not_regulated").map(([mk]) => marketName(labels, mk));
    const children = [];
    if (g.conflict) {
      const names = g.conflict.markets.map((mk) => marketName(labels, mk)).join(", ");
      children.push(h("p", { class: "conflict-note" }, `Authorities conflict (${names}): no single value satisfies all of them.` +
        (g.conflict.reference ? ` International standard: ${boundText(g.conflict.reference.min, g.conflict.reference.max, g.unit)}.` : " No international standard in this dataset.")));
    }
    children.push(h("div", { class: "bullet-head" }, [
      h("span", { class: "bullet-name" }, g.label),
      h("span", { class: "bullet-room" }, g.roomLabel),
      h("span", { class: "bullet-entered" }, ["Entered ", h("strong", {}, entered)]),
    ]));
    if (!d) return h("li", { class: "bullet" }, children);
    const row = (labelText, band, status, fallback) => {
      const misses = status === "non_compliant" ? missesOf(band, g.entered, g.unit) : [];
      const missText = misses.map((m) => m.text).join(" and ");
      return h("div", { class: "bullet-row" + (fallback ? " bullet-row-fallback" : "") }, [
        h("div", { class: "bullet-label" }, [
          glyph(h, GLYPH[status] || "?", "glyph-" + status),
          h("span", { class: "bullet-market" }, labelText),
          h("span", { class: "bullet-bound" }, boundText(band.min, band.max, g.unit)),
          h("span", { class: "bullet-status" }, (fallback ? "advisory · " : "") + (STATUS_WORD[status] || status)),
          missText ? h("span", { class: "bullet-miss" }, missText) : null,
        ]),
        bulletSvg(s, d, band, g.entered, {
          title: `${g.label} (${g.roomLabel}), ${labelText}: requires ${boundText(band.min, band.max, g.unit)}; entered ${entered} — ${STATUS_WORD[status] || status}${missText ? ", " + missText : ""}`,
          desc: `${fallback ? "Advisory international-standard band (hatched)" : "Requirement band"} with the entered value marked${misses.length ? " and the gap to the limit highlighted" : ""}; axis ${fmtNum(d.lo)} to ${fmtNum(d.hi)}${unitText(g.unit)}.`,
          fallback,
          misses,
        }),
      ]);
    };
    groups.forEach(({ band, names }) => children.push(row(names.join(", "), band, band.status, false)));
    if (g.fallback) children.push(row("International standard", g.fallback, g.fallback.status, true));
    children.push(h("div", { class: "bullet-axis", "aria-hidden": "true" }, [
      h("span", {}, fmtNum(d.lo) + unitText(g.unit)),
      h("span", {}, fmtNum(d.hi) + unitText(g.unit)),
    ]));
    if (d.offScale.length) children.push(h("p", { class: "off-scale" }, `Entered ${d.offScale.map((v) => fmtNum(v) + unitText(g.unit)).join(" and ")} is off scale — shown at the edge.`));
    if (notSpecified.length && g.fallback) children.push(h("p", { class: "chart-note" }, `No number from ${notSpecified.join(", ")}; compared with the international standard instead (advisory only).`));
    return h("li", { class: "bullet bullet-" + g.state }, children);
  }

  function numericSection(h, s, gaps, { labels, stale } = {}) {
    const body = [h("h3", {}, "Entered values against each requirement")];
    if (stale) {
      body.push(h("p", { class: "chart-note" }, "Detailed numeric comparison is available after re-evaluating."));
      return h("section", { class: "numeric-section" }, body);
    }
    const failing = (gaps || []).filter((g) => g.state === "fail" || g.state === "advisory");
    failing.sort((a, b) => (a.state === "advisory") - (b.state === "advisory"));
    if (!failing.length) {
      const list = gaps || [];
      body.push(h("p", { class: "positive-note" }, !list.length
        ? "No numeric values entered yet."
        : list.some((g) => g.state === "pass")
          ? [glyph(h, "✓", "glyph-ok"), "Every entered numeric value is within each authority's range."]
          : "The covered authorities give no number to compare the entered values against."));
      return h("section", { class: "numeric-section" }, body);
    }
    const shown = failing.slice(0, NUMERIC_LIMIT);
    const nFail = failing.filter((g) => g.state === "fail").length;
    const takeaway = `${plural(nFail, "entered value")} ${nFail === 1 ? "misses" : "miss"} at least one authority's range` +
      (failing.length - nFail ? `; ${failing.length - nFail} more ${failing.length - nFail === 1 ? "misses" : "miss"} only the advisory international standard.` : ".");
    const tableRows = [];
    shown.forEach((g) => {
      Object.entries(g.bands).filter(([, b]) => b.status === "compliant" || b.status === "non_compliant")
        .forEach(([mk, b]) => tableRows.push([`${g.label} — ${g.roomLabel}`, marketName(labels, mk), boundText(b.min, b.max, g.unit), enteredText(g.entered, g.unit), STATUS_WORD[b.status]]));
      if (g.fallback) tableRows.push([`${g.label} — ${g.roomLabel}`, "International standard (advisory)", boundText(g.fallback.min, g.fallback.max, g.unit), enteredText(g.entered, g.unit), STATUS_WORD[g.fallback.status] || g.fallback.status]);
    });
    body.push(figure(h, "numeric-figure", "How far off are the entered values?", takeaway, [
      h("ul", { class: "legend numeric-legend" }, [
        h("li", { class: "legend-item" }, [h("span", { class: "swatch sw-band-neutral", "aria-hidden": "true" }), glyph(h, "▭"), h("span", { class: "legend-text" }, "required range (fades where there is no limit)")]),
        h("li", { class: "legend-item" }, [h("span", { class: "swatch sw-miss", "aria-hidden": "true" }), glyph(h, "✗"), h("span", { class: "legend-text" }, "gap to the limit")]),
        h("li", { class: "legend-item" }, [h("span", { class: "swatch sw-band-fallback", "aria-hidden": "true" }), glyph(h, "–"), h("span", { class: "legend-text" }, "international standard (advisory)")]),
        h("li", { class: "legend-item" }, [h("span", { class: "swatch sw-marker", "aria-hidden": "true" }), glyph(h, "|"), h("span", { class: "legend-text" }, "entered value")]),
      ]),
      h("ul", { class: "bullets" }, shown.map((g) => bulletItem(h, s, g, labels))),
      failing.length > NUMERIC_LIMIT ? h("p", { class: "chart-note" }, `Showing ${NUMERIC_LIMIT} of ${failing.length} values; the rest are in Full detail below.`) : null,
      tableView(h, "Entered values against each requirement", ["Parameter", "Authority", "Required", "Entered", "Result"], tableRows),
    ]));
    return h("section", { class: "numeric-section" }, body);
  }

  // ------------------------------------------------------------ page

  // ---------------------------------------------------------------- one authority (Milestone 3)

  const ONE_STATUS = {
    pass: { glyph: "✓", word: V.status.compliant },
    fail: { glyph: "✗", word: V.status.non_compliant },
    not_covered: { glyph: "–", word: V.status.not_regulated },
    no_value: { glyph: "?", word: V.status.no_value },
  };
  const ONE_ORDER = ["fail", "pass", "no_value", "not_covered"];
  const REASON = { no_figure: "Sets no figure", no_data: "No data in dataset" };
  const ADVISORY_WORD = { pass: "met", fail: "not met" };

  // The primary authority's results: every requirement, room by room.
  // opts: { view: ResultsModel.forAuthority(...), choices: [{key,label}], onSwitch(key) }
  function authorityView(h, opts) {
    const v = opts.view;
    const choices = opts.choices || [];
    const switcher = choices.length > 1
      ? h("div", { class: "auth-switch", role: "group", "aria-label": "Show results against" },
          choices.map((c) => h("button", {
            type: "button", class: "auth-choice", "aria-pressed": String(!!v && c.key === v.key),
            onclick: () => opts.onSwitch && opts.onSwitch(c.key),
          }, c.label)))
      : null;
    if (!v) {
      const id = nextId("auth");
      return h("section", { class: "auth-view", "aria-labelledby": id }, [
        h("h3", { id }, "Results against one authority"), switcher,
        h("p", { class: "empty-state" }, "Choose a primary authority in Step 1 to see each room and requirement against it."),
      ]);
    }
    const c = v.counts;
    const verdict = VERDICT[v.verdictKey] || null;
    const countText = (n) => ONE_ORDER.filter((k) => n[k]).map((k) => `${n[k]} ${lower(ONE_STATUS[k].word)}`).join(" · ");
    const table = (caption, rows) => scrollRegion(h, `${caption}: requirements against ${v.label}`,
      h("table", { class: "results-table auth-table" }, [
        h("caption", {}, caption),
        h("thead", {}, h("tr", {}, [h("th", { scope: "col" }, "Requirement"), h("th", { scope: "col" }, "Status"), h("th", { scope: "col" }, "Note")])),
        h("tbody", {}, rows.map((r) => h("tr", { class: "auth-row st-" + r.status }, [
          h("th", { scope: "row" }, r.label),
          h("td", { class: "auth-status st-" + r.status }, [h("span", { "aria-hidden": "true" }, ONE_STATUS[r.status].glyph), ONE_STATUS[r.status].word]),
          h("td", { class: "auth-note" }, [r.reason ? REASON[r.reason] : "", r.advisory ? `International standard: ${ADVISORY_WORD[r.advisory]} (advisory)` : ""].filter(Boolean).join(". ")),
        ]))),
      ]));
    // One <details> per room: rooms with a failure open; rows without a
    // result (needs value / no rule set) folded away inside.
    const room = (rm) => {
      const n = Object.fromEntries(ONE_ORDER.map((k) => [k, rm.rows.filter((r) => r.status === k).length]));
      const shown = rm.rows.filter((r) => r.status === "fail" || r.status === "pass");
      const folded = rm.rows.filter((r) => r.status !== "fail" && r.status !== "pass");
      return h("details", { class: "auth-room", open: n.fail ? "open" : null }, [
        h("summary", {}, [h("span", { class: "auth-room-name" }, rm.label), " ", h("span", { class: "auth-room-counts" }, countText(n))]),
        shown.length ? table(rm.label, shown) : h("p", { class: "chart-note" }, "No requirement here has a result yet."),
        folded.length ? h("details", { class: "auth-folded" }, [
          h("summary", {}, `${plural(folded.length, "requirement")} without a result (needs value or no rule set)`),
          table(`${rm.label} — without a result`, folded),
        ]) : null,
      ]);
    };
    const headingId = nextId("auth");
    return h("section", { class: "auth-view", "aria-labelledby": headingId }, [
      h("h3", { id: headingId }, `Evidence against ${v.label}`),
      switcher,
      h("p", { class: "auth-summary" }, [
        verdict ? h("span", { class: "auth-verdict" }, [h("span", { "aria-hidden": "true" }, verdict.glyph + " "), verdict.word]) : null,
        countText(c),
      ]),
      ...v.rooms.map(room),
    ]);
  }

  // "2026-11-24" → "24 Nov 2026" (dates are calendar days, read as UTC).
  const formatDay = (iso) => {
    const d = new Date(String(iso) + "T00:00:00Z");
    return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  };

  // Order (results redesign): verdict per market → top fixes → room grid →
  // range charts → per-authority detail → primary-authority evidence last.
  function resultsPage(h, s, model, opts = {}) {
    const labels = opts.labels || { market: (mk) => ((model && model.markets.find((m) => m.key === mk)) || {}).label || mk };
    const dataDate = opts.dataDate ? h("p", { class: "data-date" }, "Benchmark data as of " + formatDay(opts.dataDate)) : null;
    const evidence = opts.authority ? authorityView(h, opts.authority) : null;
    if (!model || model.empty) {
      return h("div", { class: "results-page" }, [dataDate, emptyPanel(h, "No results yet", "Select at least one target market and room, then enter values."), evidence]);
    }
    const checked = model.markets.some((m) => m.checked);
    return h("div", { class: "results-page" + (opts.stale ? " results-stale" : "") }, [
      dataDate,
      verdictSection(h, s, model, opts),
      checked ? fixList(h, model, labels) : emptyPanel(h, "Nothing was checked yet", RM.fixSummary(model)),
      checked ? roomGrid(h, model) : null,
      checked ? numericSection(h, s, opts.numeric, { labels, stale: opts.stale }) : null,
      scorecards(h, s, model),
      evidence,
    ]);
  }

  return { GLYPH, formatDay, resultsPage, authorityView, verdictSection, scorecards, fixList, roomGrid, numericSection, segmentedBar, scrollRegion };
});
