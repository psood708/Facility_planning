// T10: what the projects list and project banners show for every retention
// and results state. projects-view.js takes h() as a parameter, so these tests
// render to plain objects — no DOM.
const test = require("node:test");
const assert = require("node:assert/strict");
const view = require("../projects-view.js");
const { retentionInfo } = require("../store.js");

// Plain-object h(): keeps tag, attrs and children so tests can inspect them.
function h(tag, attrs = {}, children = []) {
  const kids = (Array.isArray(children) ? children : [children]).filter((c) => c !== null && c !== undefined && c !== false);
  return { tag, attrs: attrs || {}, children: kids.map((c) => (typeof c === "number" ? String(c) : c)) };
}
const text = (n) => (n === null || n === undefined ? "" : typeof n === "string" ? n : n.children.map(text).join(" "));
const find = (n, pred) => {
  if (!n || typeof n === "string") return null;
  if (pred(n)) return n;
  for (const c of n.children) { const f = find(c, pred); if (f) return f; }
  return null;
};
const all = (n, pred, out = []) => {
  if (!n || typeof n === "string") return out;
  if (pred(n)) out.push(n);
  n.children.forEach((c) => all(c, pred, out));
  return out;
};
const byClass = (cls) => (n) => (n.attrs.class || "").split(/\s+/).includes(cls);
const button = (n, label) => find(n, (x) => x.tag === "button" && text(x).includes(label));

const NOW = new Date("2026-11-24T00:00:00Z");
const fmt = (d) => view.formatDate(d, "UTC");
const ID = (n) => `00000000-0000-4000-8000-00000000000${n}`;
function item(n, over = {}) {
  const row = { id: ID(n), name: `Plant ${n}`, notes: "", created_at: "2026-01-01T00:00:00Z", last_edited_at: "2026-11-01T00:00:00Z", flagged_for_deletion_at: null, ...over };
  return { id: row.id, name: row.name, notes: row.notes, createdAt: row.created_at, lastEditedAt: row.last_edited_at, flaggedForDeletionAt: row.flagged_for_deletion_at, retention: retentionInfo(row, NOW) };
}
const noop = () => {};
const handlers = { onKeep: noop, onDelete: noop };

// ---------------------------------------------------------------- deletion notice

test("deletionNotice: nothing for a recently edited project", () => {
  assert.equal(view.deletionNotice(h, item(1).retention, { onKeep: noop, fmt }), null);
});

test("deletionNotice: amber hint within 30 days of being flagged, with a Keep button", () => {
  const p = item(1, { last_edited_at: "2026-06-10T00:00:00Z" }); // flag date 10 Dec
  assert.equal(p.retention.state, "warning");
  const n = view.deletionNotice(h, p.retention, { onKeep: noop, fmt });
  assert.ok(byClass("deletion-hint")(n));
  assert.match(text(n), /10 Dec 2026/);
  assert.ok(button(n, "Keep this project"));
});

test("deletionNotice: flagged → full-width red banner with date, days left and Keep", () => {
  const p = item(1, { last_edited_at: "2026-05-01T00:00:00Z", flagged_for_deletion_at: "2026-11-04T02:15:00Z" });
  const n = view.deletionNotice(h, p.retention, { onKeep: noop, fmt });
  assert.ok(byClass("deletion-banner")(n));
  assert.equal(n.attrs.role, "alert");
  assert.match(text(n), /permanently deleted on 4 Dec 2026/);
  assert.match(text(n), /11 days left/);
  assert.ok(button(n, "Keep this project"));
});

test("daysText handles singular and zero", () => {
  assert.equal(view.daysText(1), "1 day left");
  assert.equal(view.daysText(0), "less than a day left");
  assert.equal(view.daysText(12), "12 days left");
});

// ---------------------------------------------------------------- list

test("projectList: empty state invites a first project", () => {
  const n = view.projectList(h, [], handlers, fmt);
  assert.match(text(n), /No saved projects yet/);
});

test("projectList: one row per project, opening by link, names kept as text", () => {
  const evil = '<img src=x onerror="alert(1)">';
  const n = view.projectList(h, [item(1, { name: evil }), item(2)], handlers, fmt);
  const rows = all(n, byClass("project-row"));
  assert.equal(rows.length, 2);
  const link = find(rows[0], (x) => x.tag === "a");
  assert.equal(link.attrs.href, `#/projects/${ID(1)}`);
  assert.ok(link.children.includes(evil), "name must be a plain text child");
  assert.match(text(rows[1]), /Edited 1 Nov 2026/);
});

test("projectList: flagged row gets a red badge with date and days left; warning row an amber hint", () => {
  const flagged = item(1, { last_edited_at: "2026-05-01T00:00:00Z", flagged_for_deletion_at: "2026-11-04T02:15:00Z" });
  const warning = item(2, { last_edited_at: "2026-06-10T00:00:00Z" });
  const ok = item(3);
  const n = view.projectList(h, [flagged, warning, ok], handlers, fmt);
  const [r1, r2, r3] = all(n, byClass("project-row"));
  assert.ok(byClass("row-flagged")(r1));
  const badge = find(r1, byClass("badge-danger"));
  assert.match(text(badge), /Deletes 4 Dec 2026 · 11 days left/);
  assert.ok(button(r1, "Keep"));
  assert.ok(find(r2, byClass("row-hint")));
  assert.ok(button(r2, "Keep"));
  assert.equal(find(r3, byClass("badge-danger")), null);
  assert.equal(button(r3, "Keep"), null);
});

test("projectList: delete needs a second, explicit confirmation", () => {
  const calls = [];
  const n = view.projectList(h, [item(1)], { onKeep: noop, onDelete: (p) => calls.push(p.id) }, fmt);
  const del = button(n, "Delete");
  assert.ok(del);
  // First click reveals confirm (handled by onclick setting state); confirm button calls onDelete.
  assert.equal(typeof del.attrs.onclick, "function");
  const confirm = find(n, (x) => x.tag === "button" && text(x).includes("Delete permanently"));
  assert.ok(confirm, "confirm button exists");
  assert.ok(byClass("confirm-delete")(find(n, byClass("confirm-delete"))));
  assert.equal(find(n, byClass("confirm-delete")).attrs.hidden, "hidden", "confirm starts hidden");
  confirm.attrs.onclick();
  assert.deepEqual(calls, [ID(1)]);
});

// ---------------------------------------------------------------- results notice

test("resultsNotice: nothing when results are current", () => {
  assert.equal(view.resultsNotice(h, { status: "current", reasons: [] }, { onReevaluate: noop }), null);
});

test("resultsNotice: stale → banner naming what changed, with Re-evaluate", () => {
  const n = view.resultsNotice(h, { status: "stale", reasons: ["data"], snapshot: {} }, { onReevaluate: noop });
  assert.ok(byClass("stale-banner")(n));
  assert.match(text(n), /benchmark data has been updated/i);
  assert.match(text(n), /as saved/);
  assert.ok(button(n, "Re-evaluate"));
  assert.match(text(view.resultsNotice(h, { status: "stale", reasons: ["engine"], snapshot: {} }, { onReevaluate: noop })), /rules engine/i);
});

test("resultsNotice: stale without a stored snapshot asks for re-evaluation", () => {
  const n = view.resultsNotice(h, { status: "stale", reasons: ["data"], snapshot: null }, { onReevaluate: noop });
  assert.match(text(n), /no saved results/i);
});

test("resultsNotice: inconsistent → explains that current results are shown", () => {
  const n = view.resultsNotice(h, { status: "inconsistent", reasons: ["x"] }, { onReevaluate: noop });
  assert.match(text(n), /differ from when this project was saved/);
});

// ---------------------------------------------------------------- read-only snapshot

test("snapshotSummary: the saved snapshot renders through the same charts, read-only", () => {
  const snap = {
    rollup: { schedule_m: "Partial", eu_gmp: "Non-Compliant" },
    evaluations: [
      { room: "Z-29", param: "HVAC-001", threshold: "GRADE-Z-29", markets: { schedule_m: { status: "non_compliant", fallback: null }, eu_gmp: { status: "non_compliant", fallback: null } } },
      { room: null, param: "UTIL-001", threshold: "THR-018", markets: { schedule_m: { status: "not_regulated", fallback: "non_compliant" }, eu_gmp: { status: "non_compliant", fallback: null } } },
    ],
    checklist: [],
    recommendations: [{ id: "GRADE-Z-29-Z-29", severity: "Significant" }, { id: "THR-018", severity: "Critical" }],
    structural: [],
  };
  const labels = { market: (mk) => ({ schedule_m: "India — Schedule M", eu_gmp: "EU GMP" })[mk], room: () => "Filling", param: (id) => id };
  const n = view.snapshotSummary(h, h, snap, labels);
  const t = text(n);
  assert.match(t, /Results as saved/);
  assert.match(t, /India — Schedule M/);
  assert.match(t, /Partial/);
  assert.match(t, /EU GMP/);
  assert.match(t, /Non-compliant/);
  assert.match(t, /1 critical/);
  assert.match(t, /Detailed numeric comparison is available after re-evaluating/);
  assert.equal(all(n, byClass("scorecard")).length, 2);
  assert.equal(find(n, (x) => x.tag === "input" || x.tag === "select"), null);
});
