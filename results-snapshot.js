/* Results snapshot — the compact record of a project's results that is saved
 * with it, and the rule for trusting it on reopen.
 *
 * Shape (ids, statuses and each gap's suggested change; no citations or notes).
 * Covers every covered authority (engine.reportState), whatever was ticked:
 *   { snapshot_version: 1, data_hash, engine_version,
 *     rollup:          { [market]: "Compliant" | "Partial" | "Non-Compliant" | ... },
 *     evaluations:     [{ room|null, param, threshold, markets: { [market]: { status, fallback|null } } }],
 *     checklist:       [{ room|null, threshold, status }],
 *     recommendations: [{ id, severity, obligation, basis, change }],  // change = suggested change text
 *     structural:      [flagId] }
 *
 * reconcile(): if the project was saved with the current data + engine, the
 * results are recomputed and must equal the snapshot ("current"); if not
 * equal, the fresh result wins and the mismatch is reported ("inconsistent").
 * If the data or engine changed, the stored snapshot is returned frozen
 * ("stale") so the UI can show it read-only with a Re-evaluate button.
 * Browser: window.ResultsSnapshot (needs FacilityEngine); Node: exports.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./engine.js"));
  else root.ResultsSnapshot = factory(root.FacilityEngine);
})(typeof self !== "undefined" ? self : this, function (engine) {
  "use strict";

  // Version 2 stores each row's per-authority statuses as a short code string
  // in the order of `markets`, so results for every covered authority stay far
  // below the 256 KB database limit. expand() reads versions 1 and 2.
  const SNAPSHOT_VERSION = 2;
  const CODE = { compliant: "c", non_compliant: "n", not_regulated: "r", not_covered: "x", no_value: "v" };
  const STATUS_OF = { c: "compliant", n: "non_compliant", r: "not_regulated", x: "not_covered", v: "no_value" };
  const hasOwn = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const roomId = (room) => (room && room.id) || null;
  const byKey = (...keys) => (a, b) => {
    for (const k of keys) {
      const x = a[k] === null ? "" : String(a[k]);
      const y = b[k] === null ? "" : String(b[k]);
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  };

  // The snapshot body (ids + statuses) from an evaluateAll() result. The
  // results page renders from this same shape, live or as saved.
  function compact(all, state) {
    const evaluations = all.rows
      .map((r) => ({
        room: roomId(r.room),
        param: r.param.id,
        threshold: r.threshold ? r.threshold.id : null,
        markets: Object.fromEntries(
          state.targetMarkets.map((mk) => {
            const m = (r.evalResult.perMarket || {})[mk] || {};
            return [mk, { status: m.status || null, fallback: m.fallback ? m.fallback.status || null : null }];
          })
        ),
      }))
      .sort(byKey("room", "param", "threshold"));
    const checklist = all.booleanRows
      .map((b) => ({ room: roomId(b.room), threshold: b.threshold ? b.threshold.id : null, status: b.status }))
      .sort(byKey("room", "threshold"));
    return {
      rollup: Object.fromEntries(state.targetMarkets.map((mk) => [mk, all.rollup[mk]])),
      evaluations,
      checklist,
      // Each gap keeps what the gap report needs even when viewed later as
      // saved: its obligation, whether it is authority or advisory, and the
      // suggested change (deterministic for the same data and engine).
      recommendations: all.recommendations
        .map((r) => ({ id: r.id, severity: r.severity, obligation: r.obligation || "unclassified", basis: r.basis === "fallback" ? "fallback" : "authority", change: String(r.text || "") }))
        .sort(byKey("id")),
      structural: all.structural.map((f) => f.id).sort(),
    };
  }

  // Saved results cover every covered authority (the cross-authority gap
  // report), whatever markets the planner ticked.
  // Suggested changes are not saved: a current project recomputes them live,
  // and a stale one must be re-evaluated anyway.
  function buildSnapshot(DATA, state, { dataHash, engineVersion }) {
    const evalState = engine.reportState(DATA, state);
    const body = compact(engine.evaluateAll(DATA, evalState), evalState);
    const markets = evalState.targetMarkets.slice();
    return {
      snapshot_version: SNAPSHOT_VERSION,
      data_hash: dataHash,
      engine_version: engineVersion,
      markets,
      rollup: body.rollup,
      evaluations: body.evaluations.map((e) => {
        const cell = (mk) => (e.markets[mk] || {});
        const row = { room: e.room, param: e.param, threshold: e.threshold, s: markets.map((mk) => CODE[cell(mk).status] || "v").join("") };
        if (markets.some((mk) => cell(mk).fallback)) row.f = markets.map((mk) => CODE[cell(mk).fallback] || "-").join("");
        return row;
      }),
      checklist: body.checklist,
      recommendations: body.recommendations.map(({ change, ...r }) => r),
      structural: body.structural,
    };
  }

  // A saved snapshot (version 1 objects or version 2 codes) in the object form
  // the results page reads, keyed by report authorities: "pics" becomes the
  // combined "eu_gmp", authorities without data are dropped. Malformed entries
  // are skipped; the input is never modified.
  function expand(snapshot, DATA) {
    if (!isObj(snapshot)) return null;
    const order = Array.isArray(snapshot.markets) ? snapshot.markets : null;
    const keyOf = (mk) => (DATA ? engine.reportKeyFor(DATA, mk) : mk);
    const remap = (obj) => {
      const out = {};
      for (const [mk, v] of Object.entries(isObj(obj) ? obj : {})) {
        const rk = keyOf(mk);
        if (rk && !hasOwn(out, rk)) out[rk] = v;
      }
      return out;
    };
    const decode = (e) => {
      if (order && typeof e.s === "string") {
        const markets = {};
        order.forEach((mk, i) => {
          const fb = typeof e.f === "string" ? e.f[i] : "-";
          markets[mk] = { status: STATUS_OF[e.s[i]] || "no_value", fallback: hasOwn(STATUS_OF, fb) ? STATUS_OF[fb] : null };
        });
        return markets;
      }
      return e.markets;
    };
    const out = {
      rollup: remap(snapshot.rollup),
      evaluations: (Array.isArray(snapshot.evaluations) ? snapshot.evaluations : []).filter(isObj)
        .map((e) => ({ room: e.room === undefined ? null : e.room, param: e.param, threshold: e.threshold, markets: remap(decode(e)) })),
      checklist: (Array.isArray(snapshot.checklist) ? snapshot.checklist : []).filter(isObj),
      recommendations: (Array.isArray(snapshot.recommendations) ? snapshot.recommendations : []).filter(isObj),
      structural: Array.isArray(snapshot.structural) ? snapshot.structural.slice() : [],
    };
    for (const k of ["snapshot_version", "data_hash", "engine_version"]) if (hasOwn(snapshot, k)) out[k] = snapshot[k];
    return out;
  }

  // Key-order-independent JSON, so a snapshot read back from Postgres jsonb
  // (which reorders keys) still compares equal.
  function canonical(v) {
    if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
    if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
    return JSON.stringify(v === undefined ? null : v);
  }
  const sameSnapshot = (a, b) => canonical(a) === canonical(b);

  function deepFreeze(o) {
    if (o && typeof o === "object" && !Object.isFrozen(o)) {
      Object.freeze(o);
      Object.values(o).forEach(deepFreeze);
    }
    return o;
  }

  // What two snapshots must agree on to be "the same results": the verdicts and
  // per-authority statuses for the authorities both cover, the checklist and
  // the structural flags. Gaps (recommendations) are derived from those rows,
  // so they are left out: older saves covered fewer authorities and stored no
  // obligation or suggested change.
  function core(snapshot, markets) {
    const keep = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([mk]) => markets.includes(mk)));
    return {
      rollup: keep(snapshot.rollup),
      evaluations: (snapshot.evaluations || []).map((e) => ({ ...e, markets: keep(e.markets) })),
      checklist: snapshot.checklist || [],
      structural: snapshot.structural || [],
    };
  }

  // project: { inputs, results_snapshot, data_hash, engine_version } with
  // inputs already validated (ProjectState.validateInputs). Snapshots come
  // back expanded (object form, report authority keys).
  function reconcile(DATA, project, versions) {
    const reasons = [];
    if (project.data_hash !== versions.dataHash) reasons.push("data");
    if (project.engine_version !== versions.engineVersion) reasons.push("engine");
    const saved = expand(project.results_snapshot, DATA);
    if (reasons.length) {
      return { status: "stale", reasons, snapshot: saved ? deepFreeze(saved) : null };
    }
    const fresh = expand(buildSnapshot(DATA, project.inputs, versions), DATA);
    if (!saved) return { status: "current", reasons: [], snapshot: fresh };
    // Compare over the authorities both cover: older saves hold only the
    // ticked markets (and may list an authority without data, now dropped).
    const shared = Object.keys(fresh.rollup).filter((mk) => hasOwn(saved.rollup, mk));
    if (!shared.length) {
      return { status: "inconsistent", reasons: ["the saved results cover no authority in the current report"], snapshot: fresh };
    }
    if (!sameSnapshot(core(fresh, shared), core(saved, shared))) {
      return { status: "inconsistent", reasons: ["results differ from the saved snapshot"], snapshot: fresh };
    }
    return { status: "current", reasons: [], snapshot: fresh };
  }

  return { SNAPSHOT_VERSION, compact, buildSnapshot, expand, reconcile, sameSnapshot };
});
