/* Exported gap report (Milestone 5): one self-contained HTML document built
 * from the same results model the page renders, so it says exactly what the
 * screen says. It opens offline in any browser, can be emailed, and prints
 * to PDF. Every piece of text is escaped, the document contains no script,
 * and it carries its own Content-Security-Policy that forbids anything but
 * its inline styles.
 *
 *   buildReport({ model, project: { name }, facility: { category, forms, targets, primary },
 *                 meta: { dataDate, dataHash, engineVersion, generatedAt }, labels }) -> { filename, html }
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

  const VERDICT_WORD = { compliant: "Compliant", partial: "Partial", non_compliant: "Non-compliant", insufficient: "Not enough data", not_covered: "Not covered" };

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
      return `<tr class="authority-row"><td>${esc(m.label)}${m.target ? ` <span class="target">Your target</span>` : ""}</td>` +
        `<td>${esc(VERDICT_WORD[m.verdictKey] || VERDICT_WORD.insufficient)}</td>` +
        `<td>${esc(c.compliant || 0)}</td><td>${esc(c.non_compliant || 0)}</td><td>${esc(c.no_value || 0)}</td>` +
        `<td>${esc(g.Critical || 0)} / ${esc(g.Significant || 0)} / ${esc(g.Partial || 0)}</td></tr>`;
    }).join("");
    return `<table><caption>The verdict is set by the worst gap; the counts are checks.</caption>` +
      `<thead><tr><th scope="col">Authority</th><th scope="col">Verdict</th><th scope="col">Met</th><th scope="col">Not met</th><th scope="col">No value</th><th scope="col">Gaps (critical / significant / partial)</th></tr></thead>` +
      `<tbody>${rows}</tbody></table>`;
  }

  function gapItem(f, labels) {
    const reach = f.basis === "authority"
      ? `Satisfies ${f.satisfies} of ${plural(f.of, "authority", "authorities")}`
      : "International standard only — misses it for";
    const names = (f.marketsFailing || []).map((mk) => (labels && labels.market ? labels.market(mk) : mk)).join(", ");
    return `<li class="gap" data-id="${esc(f.id)}"><p class="gap-change">${esc(f.change || "")}</p><dl>` +
      `<dt>Requirement</dt><dd class="gap-requirement">${esc(f.label)} · ${esc(f.roomLabel)}</dd>` +
      `<dt>Label</dt><dd class="gap-label">${esc(f.labelText || "")}</dd>` +
      `<dt>Severity</dt><dd class="gap-severity">${esc(f.severity)}</dd>` +
      `<dt>Source</dt><dd class="gap-source">${esc(f.sources && f.sources.length ? f.sources.join("; ") : "No source recorded")}</dd>` +
      `<dt>Reach</dt><dd><span class="gap-satisfies">${esc(reach)}</span>${names ? ` — ${esc(names)}` : ""}</dd>` +
      `</dl></li>`;
  }

  // The same wording as the results page in each state (nothing checked,
  // nothing to fix, or gaps), so the document never says more than the screen.
  function gapReport(model, labels) {
    const groups = (model.gapGroups || []).filter((g) => g.fixes.length);
    const markets = model.markets || [];
    const hasAuthorityGaps = (model.fixes || []).some((f) => f.basis === "authority");
    let lede;
    if (!hasAuthorityGaps && markets.every((m) => !m.checked)) {
      lede = "Nothing was checked yet, so there is nothing to fix. Enter values, or choose authorities this dataset covers.";
    } else if (!hasAuthorityGaps) {
      lede = "Nothing to fix against any covered authority among the values checked." + (markets.some((m) => (m.counts || {}).no_value) ? " Some checks have no value entered yet." : "");
    } else {
      const of = model.authorityCount || markets.length;
      lede = `Every gap with a suggested change. Mandatory gaps first; within each group, the change that satisfies the most of the ${of} authorities comes first, then by severity.`;
    }
    return `<p class="lede">${esc(lede)}</p>` +
      groups.map((g) => `<h3>${esc(g.label)} (${esc(g.fixes.length)})</h3><ol class="gaps">${g.fixes.map((f) => gapItem(f, labels)).join("")}</ol>`).join("");
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
<section><h2>Facility</h2>${facts([
      ["Dosage form category", facility.category || "—"],
      ["Specific forms", (facility.forms || []).join(", ") || "—"],
      ["Target markets", (facility.targets || []).join(", ") || "—"],
      ["Primary authority", facility.primary || "—"],
    ])}</section>
<section><h2>Performance by authority</h2>${authorityTable(model)}</section>
<section><h2>Gap report</h2>${gapReport(model, labels)}</section>
<footer class="disclaimer" role="note">${disclaimer}</footer>
</body>
</html>
`;
    return { filename: `gap-report-${slug(project.name)}-${generated.slice(0, 10)}.html`, html };
  }

  return { buildReport, DISCLAIMER_HEAD, DISCLAIMER_BODY };
});
