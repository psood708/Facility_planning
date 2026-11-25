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
 *    SVG geometry uses percentages so it never has to be measured.
 * Browser: window.ResultsView; Node: module.exports.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod;
  else root.ResultsView = mod;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Shared status glyphs (the status pills elsewhere use the same set).
  const GLYPH = { compliant: "✓", non_compliant: "✗", no_value: "?", not_regulated: "–", not_covered: "⊘" };
  const STATUS_WORD = { compliant: "met", non_compliant: "not met", no_value: "no value entered", not_regulated: "not regulated here", not_covered: "not covered by dataset" };
  const BAR_ORDER = ["compliant", "non_compliant", "no_value", "not_regulated", "not_covered"];
  const VERDICT = {
    compliant: { glyph: "✓", word: "Compliant" },
    partial: { glyph: "!", word: "Partial" },
    non_compliant: { glyph: "✗", word: "Non-compliant" },
    insufficient: { glyph: "?", word: "Not enough data" },
    not_covered: { glyph: "⊘", word: "Not covered" },
  };
  const SEVERITIES = ["Critical", "Significant", "Partial"];
  const SEV_GLYPH = { Critical: "!!!", Significant: "!!", Partial: "!" };
  const CELL = {
    fail: { glyph: "✗", word: "not met" },
    pass: { glyph: "✓", word: "met" },
    empty: { glyph: "?", word: "no value entered" },
    na: { glyph: "–", word: "not checked here" },
  };
  const SHORT = {
    schedule_m: "Sch M", us_fda: "FDA", eu_gmp: "EU", uk_mhra: "MHRA", pics: "PIC/S", who_gmp: "WHO",
    tga_australia: "TGA", china_nmpa: "NMPA", japan_pmda: "PMDA", sahpra: "SAHPRA", sfda: "SFDA",
  };
  const FIX_LIMIT = 5;
  const ROOM_LIMIT = 15;
  const NUMERIC_LIMIT = 12;

  // Counter-based ids: unique across any number of renders on one page.
  let uid = 0;
  const nextId = (p) => `rv-${p}-${++uid}`;

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;
  const pct = (v) => `${Math.round(Math.min(100, Math.max(0, v)) * 1000) / 1000}%`;
  const fmtNum = (v) => String(Math.round(v * 100) / 100);
  const short = (mk) => SHORT[mk] || String(mk).toUpperCase();
  const marketName = (labels, mk) => (labels && typeof labels.market === "function" && labels.market(mk)) || String(mk);
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

  // ------------------------------------------------------------ hero

  function heroSentence(model) {
    const n = model.markets.length;
    const covered = model.markets.filter((m) => m.verdictKey !== "not_covered");
    if (!covered.length) return `${n === 1 ? "The selected framework is" : "The selected frameworks are"} not covered by this dataset — nothing was checked`;
    const uncovered = n - covered.length;
    const tail = uncovered ? ` · ${uncovered} not covered by this dataset` : "";
    if (covered.every((m) => m.verdictKey === "insufficient")) return `Not enough values entered to judge any framework yet${tail}`;
    const met = model.markets.filter((m) => m.verdictKey === "compliant").length;
    const gaps = model.severity.total;
    const gapText = gaps ? ` · ${plural(gaps, "gap")}${model.severity.Critical ? `, ${model.severity.Critical} critical` : ""}` : " · no gaps found";
    return `Meets ${met} of ${plural(n, "framework")}${gapText}${tail}`;
  }

  function severityChart(h, s, model) {
    const sev = model.severity;
    if (!sev.total) return null;
    const title = "Gaps by severity";
    const takeaway = sev.Critical
      ? `${sev.Critical} of ${plural(sev.total, "gap")} ${sev.Critical === 1 ? "is" : "are"} critical — fix these first.`
      : `None of the ${plural(sev.total, "gap")} is critical.`;
    const desc = SEVERITIES.map((k) => `${sev[k]} ${k.toLowerCase()}`).join(", ") + ".";
    return figure(h, "severity-chart", title, takeaway, [
      segmentedBar(s, SEVERITIES.map((k) => ({ value: sev[k], cls: "sev-fill-" + k.toLowerCase() })), { title, desc, height: 12, className: "severity-bar" }),
      h("ul", { class: "legend" }, SEVERITIES.filter((k) => sev[k]).map((k) => legendItem(h, "sw-sev-" + k.toLowerCase(), SEV_GLYPH[k], `${sev[k]} ${k.toLowerCase()}`))),
      tableView(h, "Gaps by severity", ["Severity", "Gaps"], SEVERITIES.map((k) => [k, sev[k]])),
    ]);
  }

  function hero(h, s, model, { stale }) {
    const noValue = model.markets.filter((m) => m.verdictKey !== "not_covered").reduce((a, m) => Math.max(a, m.counts.no_value), 0);
    const met = model.markets.filter((m) => m.verdictKey === "compliant").length;
    const checked = model.markets.reduce((a, m) => Math.max(a, m.checked), 0);
    const stat = (label, value, extra) => h("div", { class: "stat" + (extra ? " " + extra : "") }, [h("dt", {}, label), h("dd", {}, String(value))]);
    return h("section", { class: "results-hero", "aria-label": "Summary" }, [
      h("p", { class: "hero-kicker" }, stale ? "Read-only · as saved" : "Summary"),
      h("p", { class: "hero-sentence" }, heroSentence(model)),
      noValue ? h("p", { class: "hero-note" }, `Based on ${plural(checked, "checked value")}; ${plural(noValue, "check")} ${noValue === 1 ? "has" : "have"} no value entered, so this is not a full assessment.`) : null,
      h("dl", { class: "hero-stats" }, [
        stat("Frameworks met", `${met} of ${model.markets.length}`),
        stat("Gaps", model.severity.total),
        stat("Critical", model.severity.Critical, model.severity.Critical ? "stat-critical" : null),
        model.totals.advisory ? stat("Advisory", model.totals.advisory) : null,
        noValue ? stat("No value entered", noValue) : null,
      ]),
      severityChart(h, s, model),
    ]);
  }

  // ------------------------------------------------------------ scorecards

  function scorecard(h, s, m) {
    const v = VERDICT[m.verdictKey] || VERDICT.insufficient;
    const head = h("div", { class: "sc-head" }, [
      h("h4", { class: "sc-name" }, m.label),
      m.target ? h("span", { class: "target-badge" }, "Your target") : null,
      h("span", { class: "verdict-badge verdict-" + m.verdictKey }, [glyph(h, v.glyph), h("span", { class: "verdict-word" }, v.word)]),
    ]);
    if (m.verdictKey === "not_covered") {
      return h("li", { class: "scorecard sc-not_covered" }, [
        head,
        segmentedBar(s, [{ value: 1, cls: "st-not_covered", hatched: true }], { title: `${m.label}: not covered`, desc: "This dataset has no requirements for this authority; nothing was checked.", className: "status-bar" }),
        h("p", { class: "sc-met" }, "Nothing checked"),
        h("p", { class: "sc-note" }, `This dataset has no requirements for ${m.label}, so nothing was checked. This is not a pass.`),
      ]);
    }
    const c = m.counts;
    const present = BAR_ORDER.filter((k) => c[k]);
    const desc = present.map((k) => `${c[k]} ${STATUS_WORD[k]}`).join(", ") + ".";
    const gaps = SEVERITIES.filter((k) => m.gapsBySeverity[k]);
    return h("li", { class: "scorecard sc-" + m.verdictKey }, [
      head,
      segmentedBar(s, BAR_ORDER.map((k) => ({ value: c[k], cls: "st-" + k, hatched: k === "not_covered" })), { title: `${m.label}: ${m.met} of ${m.checked} checks met`, desc, className: "status-bar" }),
      h("p", { class: "sc-met" }, [h("strong", {}, `${m.met} of ${plural(m.checked, "check")} met`)]),
      h("ul", { class: "legend sc-legend" }, present.map((k) => legendItem(h, "sw-" + k, GLYPH[k], `${c[k]} ${STATUS_WORD[k]}`))),
      h("p", { class: "sc-gaps" }, gaps.length
        ? [h("span", {}, "Gaps:")].concat(gaps.map((k, i) => h("span", { class: "sc-gap" }, [h("span", { class: "swatch sw-sev-" + k.toLowerCase(), "aria-hidden": "true" }), `${m.gapsBySeverity[k]} ${k.toLowerCase()}${i < gaps.length - 1 ? "," : ""}`])))
        : m.checked ? "No gaps against this authority." : "No checks with a value yet."),
    ]);
  }

  function scorecards(h, s, model) {
    const withNoValue = model.markets.filter((m) => m.counts.no_value).length;
    const worst = model.markets.filter((m) => m.verdictKey === "non_compliant").map((m) => m.label);
    const takeaway = worst.length
      ? `${worst.join(", ")} ${worst.length === 1 ? "has" : "have"} at least one critical gap.`
      : model.markets.some((m) => m.verdictKey === "partial") ? "No critical gaps; some authorities have gaps to close." : "One strip per authority.";
    const c = (m, k) => m.counts[k];
    return h("section", { class: "scorecards" }, [
      h("h3", {}, "By authority"),
      figure(h, "scorecard-figure", "How the facility performs against each authority", takeaway, [
        h("ul", { class: "scorecard-list" }, model.markets.map((m) => scorecard(h, s, m))),
        h("p", { class: "chart-note" }, "The verdict is set by the worst gap severity, not by the bar: any critical gap makes it Non-compliant; other gaps make it Partial. The bar counts checks." +
          (withNoValue ? " Checks with no value entered are not counted as met or not met." : "") +
          " International-standard (advisory) results never count toward an authority's verdict."),
        tableView(h, "Checks by authority",
          ["Authority", "Verdict", "Met", "Not met", "No value", "Not regulated", "Not covered", "Critical gaps", "Significant gaps", "Partial gaps"],
          model.markets.map((m) => [m.label, (VERDICT[m.verdictKey] || VERDICT.insufficient).word, c(m, "compliant"), c(m, "non_compliant"), c(m, "no_value"), c(m, "not_regulated"), c(m, "not_covered"), m.gapsBySeverity.Critical, m.gapsBySeverity.Significant, m.gapsBySeverity.Partial])),
      ]),
    ]);
  }

  // ------------------------------------------------------------ fixes

  function fixItem(h, f, labels) {
    const sev = f.severity.toLowerCase();
    const markets = h("span", { class: "fix-markets" }, f.marketsFailing.map((mk) => h("span", { class: "market-chip", title: marketName(labels, mk) }, short(mk))));
    return h("li", { class: "fix fix-row fix-" + f.basis }, [
      h("p", { class: "fix-change" + (f.change ? "" : " fix-change-missing") }, f.change || "Re-evaluate with current data to see the suggested change."),
      h("div", { class: "fix-head" }, [
        h("span", { class: "sev-chip" }, [h("span", { class: "swatch sw-sev-" + sev, "aria-hidden": "true" }), glyph(h, SEV_GLYPH[f.severity]), f.severity]),
        h("span", { class: "fix-label" }, f.label),
        h("span", { class: "fix-room" }, f.roomLabel),
      ]),
      h("div", { class: "fix-meta" }, f.basis === "authority"
        ? [h("span", { class: "fix-satisfies" }, `Satisfies ${f.satisfies} of ${plural(f.of, "authority", "authorities")}`), markets]
        : [h("span", { class: "fix-satisfies" }, "International standard only — misses it for"), markets]),
    ]);
  }

  const GROUP_LEDE = {
    unclassified: "These requirements have no mandatory/recommended label yet; the domain expert's review will classify them.",
    advisory: "Where an authority gives no number, the value is compared with the international/industry standard. This advisory group does not affect any authority's verdict.",
  };

  function gapGroup(h, g, labels) {
    const n = g.fixes.length;
    const body = [h("h4", {}, `${g.label} (${n})`)];
    if (GROUP_LEDE[g.key]) body.push(h("p", { class: "section-lede" }, GROUP_LEDE[g.key]));
    body.push(h("ol", { class: "fixes fixes-top" }, g.fixes.slice(0, FIX_LIMIT).map((f) => fixItem(h, f, labels))));
    if (n > FIX_LIMIT) {
      body.push(h("details", { class: "show-all" }, [
        h("summary", {}, `Show all ${n}`),
        h("ol", { class: "fixes fixes-more", start: String(FIX_LIMIT + 1) }, g.fixes.slice(FIX_LIMIT).map((f) => fixItem(h, f, labels))),
      ]));
    }
    return h("div", { class: `gap-group gap-${g.key}` }, body);
  }

  // Cross-authority gap report (Milestone 4): every gap with its suggested
  // change, mandatory first, ranked by how many authorities it satisfies.
  function fixList(h, model, labels) {
    const auth = model.fixes.filter((f) => f.basis === "authority");
    const body = [h("h3", {}, "What to fix first")];
    if (!auth.length && model.markets.every((m) => !m.checked)) {
      body.push(h("p", { class: "section-lede" }, "Nothing was checked yet, so there is nothing to fix. Enter values, or choose authorities this dataset covers."));
    } else if (!auth.length) {
      const noValue = model.markets.some((m) => m.counts.no_value);
      body.push(h("p", { class: "positive-note" }, [glyph(h, "✓", "glyph-ok"), "Nothing to fix against any covered authority among the values checked." + (noValue ? " Some checks have no value entered yet." : "")]));
    } else {
      const of = model.authorityCount || model.markets.length;
      body.push(h("p", { class: "section-lede" }, `Every gap with a suggested change. Mandatory gaps first; within each group, the change that satisfies the most of the ${of} authorities comes first, then by severity.`));
    }
    // Only non-empty groups; mandatory/recommended/unclassified hold authority
    // gaps only, so with none they are empty and the advisory group remains.
    (model.gapGroups || []).filter((g) => g.fixes.length).forEach((g) => body.push(gapGroup(h, g, labels)));
    return h("section", { class: "fix-list" }, body);
  }

  // ------------------------------------------------------------ room grid

  function roomGrid(h, model) {
    const markets = model.markets;
    const rows = model.rooms.map((r, i) => h("tr", { class: i >= ROOM_LIMIT ? "row-extra" : null, hidden: i >= ROOM_LIMIT ? "hidden" : null }, [
      h("th", { scope: "row" }, breakable(h, r.label)),
    ].concat(markets.map((m) => {
      const c = r.cells[m.key] || { state: "na", fails: 0 };
      const k = CELL[c.state] || CELL.na;
      return h("td", { class: "cell cell-" + c.state }, [
        glyph(h, k.glyph),
        c.state === "fail" ? h("span", { class: "cell-count" }, String(c.fails)) : null,
        srOnly(h, c.state === "fail" ? ` ${c.fails} not met` : ` ${k.word}`),
      ]);
    }))));
    const top = model.rooms[0];
    const takeaway = top && top.failTotal
      ? `${top.label} has the most gaps (${top.failTotal} across all authorities).`
      : "No room has a gap against any covered authority.";
    const extra = model.rooms.length - ROOM_LIMIT;
    const showAll = extra > 0
      ? h("button", { type: "button", class: "secondary small show-rows", onclick: (e) => {
          rows.forEach((r) => { r.hidden = false; });
          if (e && e.currentTarget) e.currentTarget.hidden = true;
        } }, `Show all ${model.rooms.length} rows`)
      : null;
    return h("section", { class: "room-grid" }, [
      h("h3", {}, "Room by authority"),
      figure(h, "grid-figure", "Where the gaps are", takeaway, [
        h("ul", { class: "legend grid-legend" }, ["fail", "pass", "empty", "na"].map((k) => legendItem(h, "sw-cell-" + k, CELL[k].glyph, k === "fail" ? "not met (count of gaps)" : CELL[k].word))),
        h("div", { class: "grid-scroll", role: "region", tabindex: "0", "aria-label": "Room by authority grid — scrolls sideways on small screens" },
          h("table", { class: "room-table" }, [
            h("caption", {}, "Gaps by room and authority"),
            h("thead", {}, h("tr", {}, [h("th", { scope: "col" }, "Room / area")].concat(markets.map((m) => h("th", { scope: "col", title: m.label }, [h("span", { "aria-hidden": "true" }, short(m.key)), srOnly(h, m.label)]))))),
            h("tbody", {}, rows),
          ])),
        extra > 0 ? h("p", { class: "chart-note" }, `Showing ${ROOM_LIMIT} of ${model.rooms.length} rows.`) : null,
        showAll,
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

  function bulletSvg(s, d, band, entered, { title, desc, fallback }) {
    const marks = [s("rect", { x: "0", y: "9", width: "100%", height: "2", class: "bullet-track" })];
    const pat = nextId("hatch");
    if (fallback) marks.unshift(s("defs", {}, hatch(s, pat, "fallback")));
    const lo = band.min === null ? d.lo : Math.max(band.min, d.lo);
    const hi = band.max === null ? d.hi : Math.min(band.max, d.hi);
    if (hi > lo) {
      marks.push(s("rect", { x: pct(d.x(lo)), y: "3", width: pct(d.x(hi) - d.x(lo)), height: "14", rx: "3", class: fallback ? "band band-fallback" : "band band-auth band-" + band.status, fill: fallback ? `url(#${pat})` : null }));
    }
    const clampX = (v) => Math.min(100, Math.max(0, d.x(v)));
    const off = (v) => v < d.lo || v > d.hi;
    if (typeof entered === "object") {
      const a = entered.min === null ? null : entered.min, b = entered.max === null ? null : entered.max;
      if (a !== null && b !== null) marks.push(s("rect", { x: pct(clampX(a)), y: "8", width: pct(clampX(b) - clampX(a)), height: "4", class: "marker-range" }));
      [a, b].filter((v) => v !== null).forEach((v) => marks.push(s("line", { x1: pct(clampX(v)), x2: pct(clampX(v)), y1: "1", y2: "19", class: "marker" + (off(v) ? " marker-off" : "") })));
    } else {
      marks.push(s("line", { x1: pct(clampX(entered)), x2: pct(clampX(entered)), y1: "1", y2: "19", class: "marker" + (off(entered) ? " marker-off" : "") }));
    }
    return chartSvg(s, { title, desc, height: 20, className: "bullet-svg" }, marks);
  }

  function bulletItem(h, s, g, labels) {
    const d = domainOf(g);
    const entered = enteredText(g.entered, g.unit);
    const shownBands = Object.entries(g.bands).filter(([, b]) => b.status === "compliant" || b.status === "non_compliant");
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
    const row = (labelText, band, status, fallback) => h("div", { class: "bullet-row" + (fallback ? " bullet-row-fallback" : "") }, [
      h("div", { class: "bullet-label" }, [
        glyph(h, GLYPH[status] || "?", "glyph-" + status),
        h("span", { class: "bullet-market" }, labelText),
        h("span", { class: "bullet-bound" }, boundText(band.min, band.max, g.unit)),
        h("span", { class: "bullet-status" }, (fallback ? "advisory · " : "") + (STATUS_WORD[status] || status)),
      ]),
      bulletSvg(s, d, band, g.entered, {
        title: `${g.label} (${g.roomLabel}), ${labelText}: requires ${boundText(band.min, band.max, g.unit)}; entered ${entered} — ${STATUS_WORD[status] || status}`,
        desc: `${fallback ? "Advisory international-standard band (hatched)" : "Requirement band"} with the entered value marked; axis ${fmtNum(d.lo)} to ${fmtNum(d.hi)}${unitText(g.unit)}.`,
        fallback,
      }),
    ]);
    shownBands.forEach(([mk, b]) => children.push(row(marketName(labels, mk), b, b.status, false)));
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
        h("li", { class: "legend-item" }, [h("span", { class: "swatch sw-band-pass", "aria-hidden": "true" }), glyph(h, "✓"), h("span", { class: "legend-text" }, "required range, met")]),
        h("li", { class: "legend-item" }, [h("span", { class: "swatch sw-band-fail", "aria-hidden": "true" }), glyph(h, "✗"), h("span", { class: "legend-text" }, "required range, not met")]),
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
    pass: { glyph: "✓", word: "Pass" },
    fail: { glyph: "✗", word: "Fail" },
    not_covered: { glyph: "⊘", word: "Not covered" },
    no_value: { glyph: "?", word: "No value" },
  };
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
      return h("section", { class: "auth-view", "aria-labelledby": "auth-heading" }, [
        h("h3", { id: "auth-heading" }, "Results against one authority"), switcher,
        h("p", { class: "empty-state" }, "Choose a primary authority in Step 1 to see each room and requirement against it."),
      ]);
    }
    const c = v.counts;
    const verdict = VERDICT[v.verdictKey] || null;
    return h("section", { class: "auth-view", "aria-labelledby": "auth-heading" }, [
      h("h3", { id: "auth-heading" }, `Against ${v.label}`),
      switcher,
      h("p", { class: "auth-summary" }, [
        verdict ? h("span", { class: "auth-verdict" }, [h("span", { "aria-hidden": "true" }, verdict.glyph + " "), verdict.word]) : null,
        `${c.pass} pass · ${c.fail} fail · ${c.not_covered} not covered · ${c.no_value} no value entered`,
      ]),
      ...v.rooms.map((room) => scrollRegion(h, `${room.label}: requirements against ${v.label}`,
        h("table", { class: "results-table auth-table" }, [
          h("caption", {}, room.label),
          h("thead", {}, h("tr", {}, [h("th", { scope: "col" }, "Requirement"), h("th", { scope: "col" }, "Status"), h("th", { scope: "col" }, "Note")])),
          h("tbody", {}, room.rows.map((r) => h("tr", { class: "auth-row st-" + r.status }, [
            h("th", { scope: "row" }, r.label),
            h("td", { class: "auth-status st-" + r.status }, [h("span", { "aria-hidden": "true" }, ONE_STATUS[r.status].glyph), ONE_STATUS[r.status].word]),
            h("td", { class: "auth-note" }, [r.reason ? REASON[r.reason] : "", r.advisory ? `International standard: ${ADVISORY_WORD[r.advisory]} (advisory)` : ""].filter(Boolean).join(". ")),
          ]))),
        ]))),
    ]);
  }

  function resultsPage(h, s, model, opts = {}) {
    const labels = opts.labels || { market: (mk) => (model.markets.find((m) => m.key === mk) || {}).label || mk };
    const hasComparison = !!model && !model.empty;
    const primary = opts.authority
      ? [authorityView(h, opts.authority), hasComparison ? h("h3", { class: "compare-heading" }, "Compare with other authorities") : null]
      : [];
    if (!model || model.empty) {
      return h("div", { class: "results-page" }, primary.concat(h("p", { class: "empty-state" }, "No results to show yet — select at least one target market and room, then enter values.")));
    }
    return h("div", { class: "results-page" + (opts.stale ? " results-stale" : "") }, [
      ...primary,
      hero(h, s, model, opts),
      scorecards(h, s, model),
      fixList(h, model, labels),
      roomGrid(h, model),
      numericSection(h, s, opts.numeric, { labels, stale: opts.stale }),
    ]);
  }

  return { GLYPH, resultsPage, authorityView, heroSentence, scorecards, fixList, roomGrid, numericSection, segmentedBar, scrollRegion };
});
