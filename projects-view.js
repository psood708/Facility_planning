/* Projects UI pieces — pure: every function takes the DOM builder h() as its
 * first argument and returns a node (or null), so each state is unit-testable.
 * Inputs come from store.js (project summaries with .retention) and
 * results-snapshot.js (reconcile results). All user text goes in as text
 * children of h(); h() never parses HTML. The wizard's step validation, error
 * summary, stepper and room-filter helpers live here too (ProjectsView.wizard).
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
  // Lead sentence in <strong>, actions grouped after the text (banner-actions)
  // so they wrap below it on narrow screens instead of squeezing the text.
  function deletionNotice(h, retention, { onKeep, fmt }) {
    if (!retention || retention.state === "ok") return null;
    const keep = h("button", { type: "button", class: "keep-button", onclick: onKeep }, "Keep this project");
    if (retention.state === "flagged") {
      return h("div", { class: "deletion-banner", role: "alert" }, [
        h("div", { class: "banner-text" }, [
          h("strong", {}, `This project will be permanently deleted on ${fmt(retention.deletionDate)} (${daysText(retention.daysLeft)}).`),
          h("span", {}, " It hasn't been edited for 6 months. Keep it to restart the clock."),
        ]),
        h("div", { class: "banner-actions" }, keep),
      ]);
    }
    return h("div", { class: "deletion-hint", role: "status" }, [
      h("div", { class: "banner-text" }, h("span", {}, `Not edited for a while: this project will be marked for deletion on ${fmt(retention.flagDate)} unless it is edited.`)),
      h("div", { class: "banner-actions" }, keep),
    ]);
  }

  // "3 projects · 1 marked for deletion · 1 due to be marked soon"
  function listSummary(items) {
    if (!items.length) return "";
    const parts = [items.length === 1 ? "1 project" : `${items.length} projects`];
    const flagged = items.filter((p) => p.retention && p.retention.state === "flagged").length;
    const warning = items.filter((p) => p.retention && p.retention.state === "warning").length;
    if (flagged) parts.push(`${flagged} marked for deletion`);
    if (warning) parts.push(`${warning} due to be marked soon`);
    return parts.join(" · ");
  }

  // Row buttons carry the project name as hidden text, so "Keep" and
  // "Delete" are unambiguous when a screen reader lists every button.
  const forName = (h, name) => h("span", { class: "visually-hidden" }, ` “${name}”`);

  function projectRow(h, p, { onKeep, onDelete }, fmt) {
    const r = p.retention;
    // Two-step delete: "Delete" reveals the confirm buttons (no browser dialogs).
    // Focus follows the toggle so keyboard users never land on a hidden button.
    const toggleConfirm = (open) => {
      confirmBox.hidden = !open;
      deleteButton.hidden = open;
      const target = open ? confirmButton : deleteButton;
      if (target.focus) target.focus();
    };
    const deleteButton = h("button", { type: "button", class: "secondary small", onclick: () => toggleConfirm(true) }, ["Delete", forName(h, p.name)]);
    const confirmButton = h("button", { type: "button", class: "danger small", onclick: () => onDelete(p) }, "Delete permanently");
    const confirmBox = h("span", { class: "confirm-delete", role: "group", "aria-label": `Confirm deleting “${p.name}”`, hidden: "hidden" }, [
      h("span", { class: "confirm-text" }, "This can't be undone."),
      confirmButton,
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
        r.state !== "ok" ? h("button", { type: "button", class: "small", onclick: () => onKeep(p) }, ["Keep", forName(h, p.name)]) : null,
        deleteButton,
        confirmBox,
      ]),
    ]);
  }

  function projectList(h, items, handlers, fmt) {
    if (!items.length) {
      return h("p", { class: "empty-state" }, "No saved projects yet. Start one with New project — it will be saved to your account.");
    }
    return h("ul", { class: "project-list", "aria-label": "Saved projects" }, items.map((p) => projectRow(h, p, handlers, fmt)));
  }

  function resultsNotice(h, results, { onReevaluate }) {
    if (!results || results.status === "current") return null;
    if (results.status === "inconsistent") {
      return h("div", { class: "stale-banner", role: "status" },
        h("div", { class: "banner-text" }, "These results differ from when this project was saved. You're seeing results from the current data — save to update the project."));
    }
    const what = results.reasons.includes("data") && results.reasons.includes("engine")
      ? "The benchmark data and the rules engine have been updated"
      : results.reasons.includes("data") ? "The benchmark data has been updated" : "The rules engine has been updated";
    const shown = results.snapshot
      ? " since this project was saved. The results below are as saved and read-only."
      : " since this project was saved, and it has no saved results to show.";
    return h("div", { class: "stale-banner", role: "status" }, [
      h("div", { class: "banner-text" }, [h("strong", {}, what), h("span", {}, shown)]),
      h("div", { class: "banner-actions" }, h("button", { type: "button", class: "secondary", onclick: onReevaluate }, "Re-evaluate with current data")),
    ]);
  }

  // Read-only view of a stored snapshot (used while results are stale). It
  // renders through the same ResultsModel/ResultsView as the live page, minus
  // the numeric comparison (snapshots hold statuses only).
  function snapshotSummary(h, s, snapshot, labels) {
    const RM = typeof ResultsModel !== "undefined" ? ResultsModel : require("./results-model.js");
    const RV = typeof ResultsView !== "undefined" ? ResultsView : require("./results-view.js");
    return h("div", { class: "panel snapshot-summary" }, [
      h("h2", {}, "Results as saved"),
      RV.resultsPage(h, s, RM.build(snapshot, labels), { stale: true, labels }),
    ]);
  }

  // ================================================================ wizard
  // Wizard presentation helpers (exported as ProjectsView.wizard; app.js
  // binds them to WizardView). Pure like the rest of this file.

  const STEP_TITLES = ["Classification", "Rooms & zones", "Parameters", "Results"];
  const STEP_COUNT = STEP_TITLES.length;

  // ---------------------------------------------------------------- validation

  // Every problem that blocks leaving step n, in the order the fields appear
  // on the page (so the error summary reads top to bottom).
  function stepIssues(n, state) {
    const issues = [];
    if (n === 1) {
      if (!state.category) issues.push({ field: "category", message: "Choose a dosage form category." });
      if (state.category === "osd_rnd_pilot" && !state.devStage) issues.push({ field: "devStage", message: "Choose the facility development stage (R&D lab or pilot plant)." });
      // The specific-forms list only appears once a category is chosen.
      if (state.category && !(state.specificForms || []).length) issues.push({ field: "specificForms", message: "Select at least one specific dosage form." });
      if (!(state.targetMarkets || []).length) issues.push({ field: "targetMarkets", message: "Select at least one target regulatory market." });
    }
    if (n === 2 && !(state.selectedRooms || []).length) {
      issues.push({ field: "selectedRooms", message: "Select at least one room or zone to assess." });
    }
    return issues;
  }

  function errorSummaryTitle(count) {
    return count === 1
      ? "There is 1 problem to fix before you continue"
      : `There are ${count} problems to fix before you continue`;
  }

  // role="alert" announces the summary as soon as it appears; tabindex="-1"
  // lets the Next button move focus to it so keyboard users start here. Each
  // item is a button (not a #fragment link: the app uses hash routing).
  function errorSummary(h, issues, { onSelect, idPrefix = "step" }) {
    if (!issues || !issues.length) return null;
    const titleId = `${idPrefix}-error-title`;
    return h("div", { class: "error-summary", role: "alert", tabindex: "-1", "aria-labelledby": titleId }, [
      h("h3", { id: titleId, class: "error-summary-title" }, errorSummaryTitle(issues.length)),
      h("ul", { class: "error-summary-list" }, issues.map((i) =>
        h("li", {}, h("button", {
          type: "button",
          class: "link-button",
          onclick: (e) => { if (e && e.preventDefault) e.preventDefault(); onSelect(i.field); },
        }, i.message)))),
    ]);
  }

  // Inline message under a field's legend. The visually hidden "Error:" means
  // the message is not conveyed by colour or the glyph alone.
  function fieldError(h, issue) {
    return h("p", { class: "field-error", id: "error-" + issue.field }, [
      h("span", { class: "field-error-glyph", "aria-hidden": "true" }, "✗"),
      h("span", { class: "visually-hidden" }, "Error: "),
      issue.message,
    ]);
  }

  // ---------------------------------------------------------------- stepper

  function stepperStates(current, total = STEP_COUNT) {
    return Array.from({ length: total }, (_, i) => (i + 1 < current ? "done" : i + 1 === current ? "current" : "upcoming"));
  }

  function stepStateLabel(s) {
    return { done: "completed", current: "current step", upcoming: "not started" }[s] || "";
  }

  const stepAnnouncement = (n) => `Step ${n} of ${STEP_COUNT}: ${STEP_TITLES[n - 1]}`;
  const nextLabel = (n) => "Next: " + STEP_TITLES[Math.min(n, STEP_COUNT - 1)];

  // ---------------------------------------------------------------- fields

  // ids must be unique per room, since the same parameter repeats per room.
  function fieldId(scope, paramId) {
    return "f-" + `${scope}-${paramId}`.replace(/[^A-Za-z0-9_-]/g, "_");
  }

  function describedBy(...ids) {
    const s = ids.filter(Boolean).join(" ");
    return s || null;
  }

  // ---------------------------------------------------------------- rooms

  function groupByStage(rooms) {
    const groups = [];
    const byStage = {};
    rooms.forEach((r) => {
      if (!byStage[r.process_stage]) {
        byStage[r.process_stage] = { stage: r.process_stage, rooms: [] };
        groups.push(byStage[r.process_stage]);
      }
      byStage[r.process_stage].rooms.push(r);
    });
    return groups;
  }

  // Every word of the query must appear somewhere in the room's searchable text.
  function roomMatches(room, query) {
    const words = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const hay = [room.name, room.process_stage, room.typical_grade, room.id].join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  }

  const selectionText = (selected, total) => `${selected} of ${total} rooms selected`;
  const filterText = (shown, total) => (shown ? `Showing ${shown} of ${total} rooms` : "No rooms match this filter");

  const wizard = {
    STEP_TITLES, STEP_COUNT, stepIssues, errorSummaryTitle, errorSummary, fieldError,
    stepperStates, stepStateLabel, stepAnnouncement, nextLabel, fieldId, describedBy,
    groupByStage, roomMatches, selectionText, filterText,
  };

  return { formatDate, daysText, deletionNotice, listSummary, projectList, resultsNotice, snapshotSummary, wizard };
});
