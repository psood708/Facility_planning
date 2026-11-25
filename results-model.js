/* Results model — what the Step 4 charts draw, derived ONLY from the compact
 * results snapshot (results-snapshot.js compact()), so the live view and the
 * read-only "as saved" view share one code path.
 *
 *   build(snapshot, labels) -> { markets, rooms, fixes, severity, totals, empty }
 *   numericGaps(rows, targetMarkets, labels) -> live-only numeric comparison
 *     from FacilityEngine.evaluateAll(...).rows (never stored in snapshots).
 *
 * labels = { market(mk), room(id), param(id), threshold(id) }; any missing
 * label falls back to the id. International-standard (fallback) results never
 * count toward an authority's counts, gaps or verdict.
 * Browser: window.ResultsModel; Node: module.exports.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod;
  else root.ResultsModel = mod;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const STATUSES = ["compliant", "non_compliant", "no_value", "not_regulated", "not_covered"];
  const GAP_SEVERITIES = ["Critical", "Significant", "Partial"];
  const SEV_RANK = { Critical: 4, Significant: 3, Partial: 2, Aligned: 1, Varies: 2 };
  const VERDICT_KEY = {
    Compliant: "compliant",
    Partial: "partial",
    "Non-Compliant": "non_compliant",
    "Insufficient Data": "insufficient",
    "Not Covered by Dataset": "not_covered",
  };

  const label = (labels, kind) => (id) => {
    const fn = labels && labels[kind];
    const v = typeof fn === "function" ? fn(id) : null;
    return v === null || v === undefined || v === "" ? String(id) : String(v);
  };
  // Saved snapshots are untrusted: skip malformed entries, and never let an
  // inherited name ("constructor", "toString") act as a verdict or severity.
  const list = (v) => (Array.isArray(v) ? v.filter((x) => !!x && typeof x === "object") : []);
  const verdictKeyOf = (v) => (Object.prototype.hasOwnProperty.call(VERDICT_KEY, v) ? VERDICT_KEY[v] : "insufficient");
  const idOf = (threshold, room) => threshold + (room ? "-" + room : "");
  const zeroCounts = () => Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const zeroSev = () => Object.fromEntries(GAP_SEVERITIES.map((s) => [s, 0]));
  const sevKey = (s) => (GAP_SEVERITIES.includes(s) ? s : "Partial");

  // Every check as { id, room, label, status[mk], fallback[mk] }: evaluation
  // rows carry per-market results; checklist rows have one status everywhere.
  function checksOf(snapshot, markets, L) {
    const evals = list(snapshot.evaluations).map((e) => ({
      id: idOf(e.threshold, e.room),
      room: e.room === undefined ? null : e.room,
      label: L.param(e.param),
      status: Object.fromEntries(markets.map((mk) => [mk, ((e.markets || {})[mk] || {}).status || "no_value"])),
      fallback: Object.fromEntries(markets.map((mk) => [mk, ((e.markets || {})[mk] || {}).fallback || null])),
    }));
    const checklist = list(snapshot.checklist).map((c) => ({
      id: idOf(c.threshold, c.room),
      room: c.room === undefined ? null : c.room,
      label: L.threshold(c.threshold),
      status: Object.fromEntries(markets.map((mk) => [mk, c.status || "no_value"])),
      fallback: {},
    }));
    // Unknown statuses read as "no value" so counts always add up.
    return evals.concat(checklist).map((c) => {
      Object.keys(c.status).forEach((mk) => { if (!STATUSES.includes(c.status[mk])) c.status[mk] = "no_value"; });
      return c;
    });
  }

  // Gap report groups, in the order the page shows them (Milestone 4).
  const GAP_GROUPS = [
    { key: "mandatory", label: "Mandatory gaps" },
    { key: "recommended", label: "Recommendations" },
    { key: "unclassified", label: "Not yet classified — pending expert review" },
    { key: "advisory", label: "Advisory: international standard only" },
  ];
  const OBLIGATIONS = ["mandatory", "recommended", "unclassified"];

  // opts.targets: the planner's target markets as report authority keys
  // (engine.reportKeyFor), marked on the scorecards.
  function build(snapshot, labels, opts = {}) {
    const targets = Array.isArray(opts.targets) ? opts.targets : [];
    const L = { market: label(labels, "market"), room: label(labels, "room"), param: label(labels, "param"), threshold: label(labels, "threshold") };
    const sn = snapshot || {};
    const keys = Object.keys(sn.rollup || {});
    const checks = checksOf(sn, keys, L);
    // An authority the dataset does not cover checks nothing — including the
    // checklist rows, which otherwise carry one status for every market.
    const uncovered = keys.filter((mk) => VERDICT_KEY[sn.rollup[mk]] === "not_covered");
    checks.forEach((c) => uncovered.forEach((mk) => { c.status[mk] = "not_covered"; c.fallback[mk] = null; }));
    const recSeverity = new Map(list(sn.recommendations).map((r) => [r.id, sevKey(r.severity)]));
    const severityOf = (id) => recSeverity.get(id) || "Partial";

    const markets = keys.map((mk) => {
      const counts = zeroCounts();
      const gapsBySeverity = zeroSev();
      checks.forEach((c) => {
        counts[c.status[mk]] += 1;
        if (c.status[mk] === "non_compliant") gapsBySeverity[severityOf(c.id)] += 1;
      });
      const verdict = String(sn.rollup[mk]);
      return {
        key: mk,
        label: L.market(mk),
        target: targets.includes(mk),
        verdict,
        verdictKey: verdictKeyOf(verdict),
        counts,
        checked: counts.compliant + counts.non_compliant,
        met: counts.compliant,
        gapsBySeverity,
      };
    });
    const coveredCount = markets.filter((m) => m.verdictKey !== "not_covered").length;

    // Rooms × markets. Facility-level checks are the "Facility" row.
    const byRoom = new Map();
    checks.forEach((c) => {
      const k = c.room === null ? "\u0000facility" : c.room;
      if (!byRoom.has(k)) byRoom.set(k, { room: c.room, checks: [] });
      byRoom.get(k).checks.push(c);
    });
    const rooms = [...byRoom.values()].map(({ room, checks: list }, order) => {
      let failTotal = 0;
      const cells = Object.fromEntries(keys.map((mk) => {
        const st = list.map((c) => c.status[mk]);
        const fails = st.filter((s) => s === "non_compliant").length;
        const passes = st.filter((s) => s === "compliant").length;
        failTotal += fails;
        const state = fails ? "fail" : passes ? "pass" : st.includes("no_value") ? "empty" : "na";
        return [mk, { state, fails, passes }];
      }));
      return { room, label: room === null ? "Facility" : L.room(room), cells, failTotal, order };
    });
    rooms.sort((a, b) => b.failTotal - a.failTotal || a.order - b.order);
    rooms.forEach((r) => delete r.order);

    // Fixes: one per recommendation id; basis is derived from the checks so a
    // saved snapshot (ids + severities only) yields the same list.
    const checkById = new Map();
    checks.forEach((c) => { if (!checkById.has(c.id)) checkById.set(c.id, c); });
    const fixes = list(sn.recommendations).map((r) => {
      const c = checkById.get(r.id);
      const failing = c ? keys.filter((mk) => c.status[mk] === "non_compliant") : [];
      const fbFailing = c ? keys.filter((mk) => c.fallback[mk] === "non_compliant") : [];
      const basis = failing.length || !fbFailing.length ? "authority" : "fallback";
      const obligation = OBLIGATIONS.includes(r.obligation) ? r.obligation : "unclassified";
      return {
        id: r.id,
        label: c ? c.label : String(r.id),
        room: c ? c.room : null,
        roomLabel: c && c.room !== null ? L.room(c.room) : "Facility",
        severity: sevKey(r.severity),
        marketsFailing: basis === "authority" ? failing : fbFailing,
        satisfies: basis === "authority" ? failing.length : 0,
        of: coveredCount,
        basis,
        obligation,
        group: basis === "fallback" ? "advisory" : obligation,
        // Older saves stored no suggested change; the page says so.
        change: typeof r.change === "string" && r.change ? r.change : null,
      };
    });
    // Mandatory, recommended, not yet classified, advisory; within each, the
    // change that satisfies the most authorities first, then by severity.
    const groupRank = (f) => GAP_GROUPS.findIndex((g) => g.key === f.group);
    fixes.sort((a, b) =>
      groupRank(a) - groupRank(b) ||
      b.satisfies - a.satisfies ||
      (SEV_RANK[b.severity] || 2) - (SEV_RANK[a.severity] || 2) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const gapGroups = GAP_GROUPS.map((g) => ({ key: g.key, label: g.label, fixes: fixes.filter((f) => f.group === g.key) }));

    const gaps = fixes.filter((f) => f.basis === "authority");
    const severity = zeroSev();
    gaps.forEach((f) => (severity[f.severity] += 1));
    severity.total = gaps.length;

    return {
      markets,
      rooms,
      fixes,
      gapGroups,
      authorityCount: coveredCount,
      severity,
      totals: { checks: checks.length, gaps: gaps.length, advisory: fixes.length - gaps.length },
      structural: (sn.structural || []).slice(),
      empty: !keys.length || !checks.length,
    };
  }

  const isBlank = (v) => v === null || v === undefined || v === "";
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  // Live only: numeric rows with a value entered, per-market bands, the
  // fallback band and the entered value — for bullet charts.
  function numericGaps(rows, targetMarkets, labels) {
    const L = { param: label(labels, "param"), room: label(labels, "room"), market: label(labels, "market") };
    const out = [];
    (rows || []).forEach((row) => {
      const t = row.threshold || {};
      if (t.type !== "numeric" || isBlank(row.entered)) return;
      const entered = typeof row.entered === "object"
        ? { min: num(row.entered.min), max: num(row.entered.max) }
        : num(Number(row.entered));
      if (entered === null || (typeof entered === "object" && entered.min === null && entered.max === null)) return;
      const per = (row.evalResult && row.evalResult.perMarket) || {};
      const bands = {};
      let fallback = null;
      targetMarkets.forEach((mk) => {
        const r = per[mk] || { status: "no_value" };
        bands[mk] = { min: num(r.min), max: num(r.max), status: r.status || "no_value" };
        if (r.fallback && (num(r.fallback.min) !== null || num(r.fallback.max) !== null)) {
          if (!fallback) fallback = { min: num(r.fallback.min), max: num(r.fallback.max), status: r.fallback.status, note: r.fallback.note || null, markets: [] };
          fallback.markets.push(mk);
        }
      });
      const statuses = Object.values(bands).map((b) => b.status);
      const state = statuses.includes("non_compliant") ? "fail"
        : fallback && fallback.status === "non_compliant" ? "advisory"
        : statuses.includes("compliant") || (fallback && fallback.status === "compliant") ? "pass" : "none";
      const room = row.room ? row.room.id : null;
      const conflict = row.evalResult && row.evalResult.conflict
        ? { markets: row.evalResult.conflict.markets.slice(), reference: row.evalResult.conflict.reference ? { min: num(row.evalResult.conflict.reference.min), max: num(row.evalResult.conflict.reference.max) } : null }
        : null;
      out.push({
        id: idOf(t.id, room),
        room,
        roomLabel: room ? (row.room.name || L.room(room)) : "Facility",
        label: (row.param && row.param.name) || L.param(row.param && row.param.id),
        unit: t.unit || "",
        entered,
        bands,
        fallback,
        conflict,
        state,
        severity: sevKey(t.severity || (row.param && row.param.gap_severity)),
      });
    });
    return out;
  }

  // One authority (Milestone 3): every requirement, room by room, with that
  // authority's status as Pass / Fail / Not covered / No value. "Not covered"
  // keeps its reason: the authority sets no figure, or the dataset has no data.
  // An international-standard (fallback) result is kept as advisory only.
  const ONE = { compliant: ["pass", null], non_compliant: ["fail", null], not_regulated: ["not_covered", "no_figure"], not_covered: ["not_covered", "no_data"], no_value: ["no_value", null] };
  const ADVISORY = { compliant: "pass", non_compliant: "fail" };
  const hasKey = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

  function forAuthority(snapshot, mk, labels) {
    const sn = snapshot || {};
    const inResults = hasKey(sn.rollup, mk) || (sn.evaluations || []).some((e) => e.markets && hasKey(e.markets, mk));
    if (!inResults) return null;
    const L = { market: label(labels, "market"), room: label(labels, "room"), param: label(labels, "param"), threshold: label(labels, "threshold") };
    const counts = { pass: 0, fail: 0, not_covered: 0, no_value: 0 };
    const groups = new Map([[null, []]]);
    for (const c of checksOf(sn, [mk], L)) {
      const [status, reason] = ONE[c.status[mk]] || ONE.no_value;
      counts[status] += 1;
      if (!groups.has(c.room)) groups.set(c.room, []);
      groups.get(c.room).push({ id: c.id, label: c.label, status, reason, advisory: hasKey(ADVISORY, c.fallback[mk]) ? ADVISORY[c.fallback[mk]] : null });
    }
    // What needs action first: failures, then passes, then gaps in the data.
    const RANK = { fail: 0, pass: 1, no_value: 2, not_covered: 3 };
    const byStatus = (rows) => rows.map((r, i) => [r, i]).sort((x, y) => RANK[x[0].status] - RANK[y[0].status] || x[1] - y[1]).map(([r]) => r);
    const rooms = [...groups].filter(([, rows]) => rows.length).map(([room, rows]) => ({ room, label: room === null ? "Facility" : L.room(room), rows: byStatus(rows) }));
    const verdict = (sn.rollup || {})[mk] || null;
    return { key: mk, label: L.market(mk), verdict, verdictKey: verdict ? verdictKeyOf(verdict) : null, counts, rooms };
  }

  return { STATUSES, GAP_SEVERITIES, VERDICT_KEY, build, numericGaps, forAuthority };
});
