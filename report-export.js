/* Exported gap report (Milestone 5): one self-contained HTML document built
 * from the same results model the page renders, so it says exactly what the
 * screen says. It opens offline in any browser, can be emailed, and prints
 * to PDF. Every piece of text is escaped, the document contains no script,
 * and it carries its own Content-Security-Policy that forbids anything but
 * its inline styles.
 *
 *   buildReport({ model, project: { name }, facility: { category, forms, targets, primary },
 *                 meta: { dataDate, dataHash, engineVersion, generatedAt }, labels }) -> { filename, html }
 * Its words and order follow the results page (results redesign, Phase 1):
 * verdict per market first, then the fix list ranked by severity.
 * Browser: window.ReportExport; Node: module.exports.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod;
  else root.ReportExport = mod;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const esc = (v) => String(v === null || v === undefined ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  const formatDay = (iso) => {
    const d = new Date(String(iso).slice(0, 10) + "T00:00:00Z");
    return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const slug = (s) => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "project";

  const RM = typeof ResultsModel !== "undefined" ? ResultsModel : require("./results-model.js");
  const V = RM.VOCAB;

  const DISCLAIMER_HEAD = "Advisory only — this report is not a regulatory sign-off.";
  const DISCLAIMER_BODY = "It compares the facility design entered by the planner with benchmark data compiled from regulatory guidance; it does not certify compliance with any authority. Mandatory/recommended labels marked “draft” and sources marked “pending” are awaiting expert review. Confirm every requirement with the relevant authority and a qualified professional before acting.";

  const STYLE = `
    @page { margin: 18mm 16mm; }
    * { box-sizing: border-box; }
    body { font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color: #1c2733; margin: 0 auto; max-width: 880px; padding: 24px; }
    h1 { font-size: 24px; margin: 0 0 4px; }
    h2 { font-size: 18px; margin: 28px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #dfe5ea; }
    h3 { font-size: 15px; margin: 20px 0 6px; }
    .project { font-size: 16px; font-weight: 600; margin: 0 0 8px; }
    .meta { color: #5b6b7a; margin: 0; }
    ul.verdicts { list-style: none; padding: 0; margin: 0 0 8px; }
    li.verdict { padding: 6px 0; border-bottom: 1px solid #eceff2; }
    .verdict-place { font-weight: 600; }
    .verdict-word { font-weight: 700; margin-left: 8px; }
    .verdict-detail { color: #5b6b7a; margin-left: 8px; }
    .completeness, .headline { margin: 6px 0; }
    .headline { font-weight: 600; }
    .gap-title { color: #5b6b7a; margin: 0 0 2px; font-size: 13px; }
    .note { color: #5b6b7a; font-size: 13px; margin: 0 0 8px; }
    .disclaimer { border: 2px solid #a3281c; border-radius: 8px; padding: 10px 14px; margin: 16px 0; }
    .disclaimer strong { color: #a3281c; }
    dl.facts { display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin: 0; }
    dl.facts dt { font-weight: 600; }
    dl.facts dd { margin: 0; }
    table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
    caption { text-align: left; color: #5b6b7a; padding: 0 0 6px; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #dfe5ea; vertical-align: top; }
    th { font-size: 12px; text-transform: uppercase; letter-spacing: 0.02em; color: #5b6b7a; }
    .target { font-size: 12px; font-weight: 700; color: #095050; }
    ol.gaps { padding-left: 22px; margin: 0; }
    li.gap { margin: 0 0 12px; padding-bottom: 10px; border-bottom: 1px solid #eceff2; break-inside: avoid; }
    .gap-change { font-weight: 600; margin: 0 0 4px; }
    li.gap dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 0; font-size: 13px; }
    li.gap dt { color: #5b6b7a; }
    li.gap dd { margin: 0; }
    .lede { color: #5b6b7a; margin: 0 0 8px; }
    footer { margin-top: 32px; }
  `;

  function facts(pairs) {
    return `<dl class="facts">${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
  }

  function authorityTable(model) {
    const rows = (model.markets || []).map((m) => {
      const c = m.counts || {};
      const g = m.gapsBySeverity || {};
      return `<tr class="authority-row"><td>${esc(m.place || m.label)}${m.target ? ` <span class="target">Your target</span>` : ""}</td>` +
        `<td>${esc(V.verdict[m.verdictKey] || V.verdict.insufficient)}</td>` +
        `<td>${esc(c.compliant || 0)}</td><td>${esc(c.non_compliant || 0)}</td><td>${esc(c.no_value || 0)}</td>` +
        `<td>${esc(g.Critical || 0)} / ${esc(g.Significant || 0)} / ${esc(g.Partial || 0)}</td></tr>`;
    }).join("");
    const sev = ["Critical", "Significant", "Partial"].map((k) => RM.severityWord(k).toLowerCase()).join(" / ");
    return `<table><caption>The verdict is set by the worst gap; the counts are checks.</caption>` +
      `<thead><tr><th scope="col">Authority</th><th scope="col">Verdict</th><th scope="col">${esc(V.status.compliant)}</th><th scope="col">${esc(V.status.non_compliant)}</th><th scope="col">${esc(V.status.no_value)}</th><th scope="col">Gaps (${esc(sev)})</th></tr></thead>` +
      `<tbody>${rows}</tbody></table>`;
  }

  function gapItem(f, labels) {
    const reach = f.basis === "authority"
      ? `Satisfies ${f.satisfies} of ${plural(f.of, "authority", "authorities")}`
      : "International standard only — misses it for";
    const names = (f.marketsFailing || []).map((mk) => (labels && labels.market ? labels.market(mk) : mk)).join(", ");
    return `<li class="gap" data-id="${esc(f.id)}"><p class="gap-title">${esc(f.title || "")}</p><p class="gap-change">${esc(f.change || "")}</p><dl>` +
      `<dt>Requirement</dt><dd class="gap-requirement">${esc(f.label)} · ${esc(f.roomLabel)}</dd>` +
      `<dt>Label</dt><dd class="gap-label">${esc(f.labelText || "")}</dd>` +
      `<dt>Severity</dt><dd class="gap-severity">${esc(RM.severityWord(f.severity))}</dd>` +
      `<dt>Source</dt><dd class="gap-source">${esc(f.sources && f.sources.length ? f.sources.join("; ") : "No source recorded")}</dd>` +
      `<dt>Reach</dt><dd><span class="gap-satisfies">${esc(reach)}</span>${names ? ` — ${esc(names)}` : ""}</dd>` +
      `</dl></li>`;
  }

  // Verdict per market, in the screen's order and words, with completeness and the headline.
  function verdicts(model) {
    const items = (model.verdicts || []).map((v) => `<li class="verdict"><span class="verdict-place">${esc(v.place)}</span>` +
      (v.target ? ` <span class="target">Your target</span>` : "") +
      `<span class="verdict-word">${esc(v.word)}</span><span class="verdict-detail">${esc(v.detail)}</span></li>`).join("");
    return `<ul class="verdicts">${items}</ul>` +
      `<p class="completeness">${esc(RM.completenessText(model))}</p><p class="headline">${esc(RM.fixSummary(model))}</p>`;
  }

  // The fix list as the screen shows it: one list ranked by severity, then
  // the advisory group. Every fix is listed (the screen folds all but 3).
  function gapReport(model, labels) {
    const groups = model.gapGroups || [];
    const main = (groups.find((g) => g.key === "gaps") || { fixes: [] }).fixes;
    const advisory = groups.find((g) => g.key === "advisory") || { label: "", fixes: [] };
    let out;
    if (!main.length) out = `<p class="lede">${esc(RM.fixSummary(model))}</p>`;
    else {
      out = `<p class="lede">${esc(RM.NOTES.order)}</p>` + (main.some((f) => f.draft) ? `<p class="note">${esc(RM.NOTES.draft)}</p>` : "") +
        `<ol class="gaps">${main.map((f) => gapItem(f, labels)).join("")}</ol>`;
    }
    if (advisory.fixes.length) {
      out += `<h3>${esc(advisory.label)} (${esc(advisory.fixes.length)})</h3><p class="note">${esc(RM.NOTES.advisory)}</p>` +
        `<ol class="gaps">${advisory.fixes.map((f) => gapItem(f, labels)).join("")}</ol>`;
    }
    return out;
  }

  function buildReport({ model, project = {}, facility = {}, meta = {}, labels = null }) {
    const name = String(project.name || "").trim() || "Untitled project";
    const generated = String(meta.generatedAt || new Date().toISOString());
    const disclaimer = `<strong>${esc(DISCLAIMER_HEAD)}</strong> ${esc(DISCLAIMER_BODY)}`;
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gap report — ${esc(name)}</title>
<style>${STYLE}</style>
</head>
<body>
<header>
<h1>Cross-authority gap report</h1>
<p class="project">${esc(name)}</p>
<p class="meta">Generated ${esc(formatDay(generated))} · Benchmark data as of ${esc(meta.dataDate ? formatDay(meta.dataDate) : "date unknown")} · Rules engine ${esc(meta.engineVersion)} · Data version ${esc(String(meta.dataHash || "").slice(0, 12))}</p>
</header>
<section class="disclaimer" role="note">${disclaimer}</section>
<section><h2>Verdict by market</h2>${verdicts(model)}</section>
<section><h2>What to fix first</h2>${gapReport(model, labels)}</section>
<section><h2>Facility</h2>${facts([
      ["Dosage form category", facility.category || "—"],
      ["Specific forms", (facility.forms || []).join(", ") || "—"],
      ["Target markets", (facility.targets || []).join(", ") || "—"],
      ["Primary authority", facility.primary || "—"],
    ])}</section>
<section><h2>By authority</h2>${authorityTable(model)}</section>
<footer class="disclaimer" role="note">${disclaimer}</footer>
</body>
</html>
`;
    return { filename: `gap-report-${slug(project.name)}-${generated.slice(0, 10)}.html`, html };
  }

  return { buildReport, DISCLAIMER_HEAD, DISCLAIMER_BODY };
});
