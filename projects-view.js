/* Projects UI pieces — pure: every function takes the DOM builder h() as its
 * first argument and returns a node (or null), so each state is unit-testable.
 * Inputs come from store.js (project summaries with .retention) and
 * results-snapshot.js (reconcile results). All user text goes in as text
 * children of h(); h() never parses HTML.
 * Browser: window.ProjectsView; Node: module.exports.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod;
  else root.ProjectsView = mod;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SEVERITIES = ["Critical", "Significant", "Partial", "Aligned"];

  // "4 Dec 2026". timeZone is for tests; browsers use the viewer's zone.
  const formatDate = (d, timeZone) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone });

  function daysText(n) {
    if (n <= 0) return "less than a day left";
    return n === 1 ? "1 day left" : `${n} days left`;
  }

  // Banner/hint shown above an open project (and reused in the list).
  function deletionNotice(h, retention, { onKeep, fmt }) {
    if (!retention || retention.state === "ok") return null;
    const keep = h("button", { type: "button", class: "keep-button", onclick: onKeep }, "Keep this project");
    if (retention.state === "flagged") {
      return h("div", { class: "deletion-banner", role: "alert" }, [
        h("strong", {}, `This project will be permanently deleted on ${fmt(retention.deletionDate)} (${daysText(retention.daysLeft)}).`),
        h("span", {}, " It hasn't been edited for 6 months. Keep it to restart the clock."),
        keep,
      ]);
    }
    return h("div", { class: "deletion-hint", role: "status" }, [
      h("span", {}, `Not edited for a while: this project will be marked for deletion on ${fmt(retention.flagDate)} unless it is edited.`),
      keep,
    ]);
  }

  function projectRow(h, p, { onKeep, onDelete }, fmt) {
    const r = p.retention;
    // Two-step delete: "Delete" reveals the confirm buttons (no browser dialogs).
    const toggleConfirm = (open) => { confirmBox.hidden = !open; deleteButton.hidden = open; };
    const deleteButton = h("button", { type: "button", class: "secondary small", onclick: () => toggleConfirm(true) }, "Delete");
    const confirmBox = h("span", { class: "confirm-delete", hidden: "hidden" }, [
      h("button", { type: "button", class: "danger small", onclick: () => onDelete(p) }, "Delete permanently"),
      h("button", { type: "button", class: "secondary small", onclick: () => toggleConfirm(false) }, "Cancel"),
    ]);

    return h("li", { class: "project-row" + (r.state === "flagged" ? " row-flagged" : r.state === "warning" ? " row-warning" : "") }, [
      h("div", { class: "row-main" }, [
        h("a", { href: `#/projects/${p.id}`, class: "project-name" }, p.name),
        h("span", { class: "row-meta" }, `Edited ${fmt(p.lastEditedAt)}`),
        r.state === "flagged" ? h("span", { class: "badge badge-danger" }, `Deletes ${fmt(r.deletionDate)} · ${daysText(r.daysLeft)}`) : null,
        r.state === "warning" ? h("span", { class: "row-hint" }, `Marked for deletion on ${fmt(r.flagDate)} unless edited`) : null,
      ]),
      h("div", { class: "row-actions" }, [
        r.state !== "ok" ? h("button", { type: "button", class: "small", onclick: () => onKeep(p) }, "Keep") : null,
        deleteButton,
        confirmBox,
      ]),
    ]);
  }

  function projectList(h, items, handlers, fmt) {
    if (!items.length) {
      return h("p", { class: "empty-state" }, "No saved projects yet. Start one with New project — it will be saved to your account.");
    }
    return h("ul", { class: "project-list" }, items.map((p) => projectRow(h, p, handlers, fmt)));
  }

  function resultsNotice(h, results, { onReevaluate }) {
    if (!results || results.status === "current") return null;
    if (results.status === "inconsistent") {
      return h("div", { class: "stale-banner", role: "status" },
        "These results differ from when this project was saved. You're seeing results from the current data — save to update the project.");
    }
    const what = results.reasons.includes("data") && results.reasons.includes("engine")
      ? "The benchmark data and the rules engine have been updated"
      : results.reasons.includes("data") ? "The benchmark data has been updated" : "The rules engine has been updated";
    const shown = results.snapshot
      ? " since this project was saved. The results below are as saved and read-only."
      : " since this project was saved, and it has no saved results to show.";
    return h("div", { class: "stale-banner", role: "status" }, [
      h("span", {}, what + shown),
      h("button", { type: "button", onclick: onReevaluate }, "Re-evaluate with current data"),
    ]);
  }

  // Read-only view of a stored snapshot (used while results are stale).
  function snapshotSummary(h, snapshot, marketLabel) {
    const counts = {};
    (snapshot.recommendations || []).forEach((r) => (counts[r.severity] = (counts[r.severity] || 0) + 1));
    return h("div", { class: "panel snapshot-summary" }, [
      h("h2", {}, "Results as saved"),
      h("table", { class: "results-table" }, [
        h("thead", {}, h("tr", {}, [h("th", {}, "Framework"), h("th", {}, "Verdict")])),
        h("tbody", {}, Object.keys(snapshot.rollup || {}).map((mk) => h("tr", {}, [h("td", {}, marketLabel(mk)), h("td", {}, String(snapshot.rollup[mk]))]))),
      ]),
      h("h3", {}, "Findings by severity"),
      h("table", { class: "results-table" }, [
        h("tbody", {}, SEVERITIES.filter((s) => counts[s]).map((s) => h("tr", {}, [h("td", {}, s), h("td", {}, String(counts[s]))]))),
      ]),
    ]);
  }

  return { formatDate, daysText, deletionNotice, projectList, resultsNotice, snapshotSummary };
});
