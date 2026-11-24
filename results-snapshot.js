/* Results snapshot — the compact record of a project's results that is saved
 * with it, and the rule for trusting it on reopen.
 *
 * Shape (ids and statuses only; no free text, citations or entered values):
 *   { snapshot_version: 1, data_hash, engine_version,
 *     rollup:          { [market]: "Compliant" | "Partial" | "Non-Compliant" | ... },
 *     evaluations:     [{ room|null, param, threshold, markets: { [market]: { status, fallback|null } } }],
 *     checklist:       [{ room|null, threshold, status }],
 *     recommendations: [{ id, severity }],
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

  const SNAPSHOT_VERSION = 1;
  const roomId = (room) => (room && room.id) || null;
  const byKey = (...keys) => (a, b) => {
    for (const k of keys) {
      const x = a[k] === null ? "" : String(a[k]);
      const y = b[k] === null ? "" : String(b[k]);
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  };

  function buildSnapshot(DATA, state, { dataHash, engineVersion }) {
    const all = engine.evaluateAll(DATA, state);
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
      snapshot_version: SNAPSHOT_VERSION,
      data_hash: dataHash,
      engine_version: engineVersion,
      rollup: Object.fromEntries(state.targetMarkets.map((mk) => [mk, all.rollup[mk]])),
      evaluations,
      checklist,
      recommendations: all.recommendations.map((r) => ({ id: r.id, severity: r.severity })).sort(byKey("id")),
      structural: all.structural.map((f) => f.id).sort(),
    };
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

  // project: { inputs, results_snapshot, data_hash, engine_version } with
  // inputs already validated (ProjectState.validateInputs).
  function reconcile(DATA, project, versions) {
    const reasons = [];
    if (project.data_hash !== versions.dataHash) reasons.push("data");
    if (project.engine_version !== versions.engineVersion) reasons.push("engine");
    if (reasons.length) {
      return { status: "stale", reasons, snapshot: project.results_snapshot ? deepFreeze(project.results_snapshot) : null };
    }
    const fresh = buildSnapshot(DATA, project.inputs, versions);
    if (project.results_snapshot && !sameSnapshot(fresh, project.results_snapshot)) {
      return { status: "inconsistent", reasons: ["results differ from the saved snapshot"], snapshot: fresh };
    }
    return { status: "current", reasons: [], snapshot: fresh };
  }

  return { SNAPSHOT_VERSION, buildSnapshot, reconcile, sameSnapshot };
});
