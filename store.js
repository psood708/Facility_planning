/* Project store — the only code that talks to Supabase about projects.
 *
 * createStore({ client, DATA, versions, ProjectState, ResultsSnapshot }) where
 * client is a supabase-js client (or a fake in tests) and versions is
 * { dataHash, engineVersion }. Rules:
 *  - Everything is validated before it is sent; invalid input never leaves the browser.
 *  - Writes send an explicit column whitelist — never owner_id or retention
 *    columns (the database sets those; see supabase/migrations).
 *  - Missing and not-yours look the same: null (R1).
 *  - Payloads read back are validated again before anything uses them (R6).
 * Browser: window.ProjectStore; Node: module.exports.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod;
  else root.ProjectStore = mod;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TABLE = "projects";
  const SUMMARY_COLUMNS = "id,name,notes,created_at,last_edited_at,flagged_for_deletion_at";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const DAY = 24 * 3600 * 1000;
  const GRACE_DAYS = 30;
  const RETENTION_MONTHS = 6;
  const WARNING_DAYS = 30;

  class StoreError extends Error {
    constructor(code, message, extra = {}) {
      super(message);
      this.name = "StoreError";
      this.code = code; // "invalid" | "invalid_project" | "not_found" | "too_large" | "limit" | "server"
      Object.assign(this, extra);
    }
  }

  function addMonthsUTC(date, months) {
    const d = new Date(date);
    d.setUTCMonth(d.getUTCMonth() + months);
    return d;
  }

  // What the projects list and banner show about deletion.
  //   ok       — nothing to show
  //   warning  — within 30 days of being flagged (amber hint)
  //   flagged  — will be permanently deleted on deletionDate (red badge + banner)
  function retentionInfo(row, now = new Date()) {
    const lastEdited = new Date(row.last_edited_at);
    const flagDate = addMonthsUTC(lastEdited, RETENTION_MONTHS);
    if (row.flagged_for_deletion_at) {
      const deletionDate = new Date(new Date(row.flagged_for_deletion_at).getTime() + GRACE_DAYS * DAY);
      const daysLeft = Math.max(0, Math.ceil((deletionDate - now) / DAY));
      return { state: "flagged", flagDate, deletionDate, daysLeft };
    }
    if (now.getTime() >= flagDate.getTime() - WARNING_DAYS * DAY) return { state: "warning", flagDate, deletionDate: null, daysLeft: null };
    return { state: "ok", flagDate, deletionDate: null, daysLeft: null };
  }

  function summary(row, now) {
    return {
      id: row.id,
      name: row.name,
      notes: row.notes,
      createdAt: row.created_at,
      lastEditedAt: row.last_edited_at,
      flaggedForDeletionAt: row.flagged_for_deletion_at,
      retention: retentionInfo(row, now),
    };
  }

  // The database refuses a results snapshot over 256 KB (measured as
  // jsonb::text, which adds spaces). Check before sending, with headroom.
  const SNAPSHOT_BYTES_MAX = 0.9 * 256 * 1024;
  const jsonbBytes = (v) => {
    const json = JSON.stringify(v);
    const spaces = (json.match(/":|,"/g) || []).length; // jsonb::text writes ": " and ", "
    return new TextEncoder().encode(json).length + spaces;
  };

  function createStore({ client, DATA, versions, ProjectState, ResultsSnapshot, limits = {} }) {
    const snapshotBytesMax = limits.snapshotBytes || SNAPSHOT_BYTES_MAX;
    async function run(query) {
      const { data, error } = await query;
      // 54000: the per-user project cap (migration 20261126120000_project_cap.sql).
      if (error && error.code === "54000") throw new StoreError("limit", "You've reached the limit of 200 saved projects. Delete one you no longer need, then save again.", { serverCode: error.code });
      if (error) throw new StoreError("server", error.message || "Server error", { serverCode: error.code });
      return data;
    }
    function checkId(id) {
      if (typeof id !== "string" || !UUID.test(id)) throw new StoreError("not_found", "Project not found");
    }

    // Validated, whitelisted columns for insert/update.
    function body({ name, notes, state }) {
      const r = ProjectState.validateProject({ name, notes: notes || "", inputs: ProjectState.serializeInputs(state) }, DATA);
      if (!r.ok) throw new StoreError("invalid", "Project is not valid", { errors: r.errors });
      const { project } = r;
      const snapshot = ResultsSnapshot.buildSnapshot(DATA, project.inputs, versions);
      if (jsonbBytes(snapshot) > snapshotBytesMax) {
        throw new StoreError("too_large", "This project's results are too large to save. Remove some rooms, then save again.");
      }
      return {
        name: project.name,
        notes: project.notes,
        inputs: project.inputs,
        data_hash: versions.dataHash,
        engine_version: versions.engineVersion,
        results_snapshot: snapshot,
      };
    }

    function full(row, now) {
      const v = ProjectState.validateInputs(row.inputs, DATA);
      if (!v.ok) throw new StoreError("invalid_project", "This saved project could not be loaded safely", { errors: v.errors });
      const results = ResultsSnapshot.reconcile(DATA, { ...row, inputs: v.inputs }, versions);
      return { ...summary(row, now), inputs: v.inputs, results };
    }

    return {
      async list({ now = new Date() } = {}) {
        const rows = await run(client.from(TABLE).select(SUMMARY_COLUMNS).order("last_edited_at", { ascending: false }));
        const items = (rows || []).map((r) => summary(r, now));
        // Projects about to be deleted go first, soonest deletion first; the
        // rest keep the server's newest-edit-first order.
        const flagged = items.filter((p) => p.retention.state === "flagged").sort((a, b) => a.retention.deletionDate - b.retention.deletionDate);
        return flagged.concat(items.filter((p) => p.retention.state !== "flagged"));
      },

      async get(id, { now = new Date() } = {}) {
        checkId(id);
        const row = await run(client.from(TABLE).select("*").eq("id", id).maybeSingle());
        return row ? full(row, now) : null;
      },

      async create({ name, notes, state }, { now = new Date() } = {}) {
        const values = body({ name, notes, state }); // validate before touching the client
        const row = await run(client.from(TABLE).insert(values).select().single());
        return full(row, now);
      },

      async update(id, { name, notes, state }, { now = new Date() } = {}) {
        checkId(id);
        const values = body({ name, notes, state });
        const row = await run(client.from(TABLE).update(values).eq("id", id).select().maybeSingle());
        return row ? full(row, now) : null;
      },

      // "Keep this project": any write restarts the retention clock and clears
      // the flag (database trigger). Re-sending the current name is that write.
      async keep(id, { now = new Date() } = {}) {
        checkId(id);
        const current = await run(client.from(TABLE).select("name").eq("id", id).maybeSingle());
        if (!current) return null;
        const row = await run(client.from(TABLE).update({ name: current.name }).eq("id", id).select(SUMMARY_COLUMNS).maybeSingle());
        return row ? summary(row, now) : null;
      },

      async remove(id) {
        checkId(id);
        const rows = await run(client.from(TABLE).delete().eq("id", id).select("id"));
        return Array.isArray(rows) && rows.length > 0;
      },
    };
  }

  return { createStore, retentionInfo, StoreError };
});
