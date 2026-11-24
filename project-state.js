/* Project state — turn wizard state into a saveable payload and back.
 * Saved payloads are untrusted (R6): validateInputs checks every key and value
 * against the loaded dataset and returns a freshly built copy; resetState then
 * copies known fields one by one into the app's state object. No payload is
 * ever Object.assign'ed into state. Browser: window.ProjectState; Node: exports.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod;
  else root.ProjectState = mod;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const CATEGORY_DEFS = [
    { key: "ext_prep", label: "External Preparations", desc: "Liquids, creams, ointments, gels, dusting powders" },
    { key: "osd_production", label: "OSD Production", desc: "Commercial-scale tablets, capsules, oral powders, MDF, buccal film" },
    { key: "osd_rnd_pilot", label: "OSD R&D / Pilot Plant", desc: "Non-commercial development & pilot-scale OSD work" },
    { key: "sterile", label: "Sterile", desc: "Parenterals, ophthalmics, dry-powder reconstitution, implants" },
  ];
  const OSD_FORMS = ["Tablet (Uncoated)", "Tablet (Coated)", "Tablet (Extended Release)", "Tablet (Modified Release)", "Capsule", "Oral Powder", "MDF (Mouth Dissolving Film)", "Buccal Film"];
  const SPECIFIC_FORMS = {
    ext_prep: ["Liquid", "Emulsion", "Suspension", "Cream", "Ointment", "Gel", "Dusting Powder"],
    osd_production: OSD_FORMS,
    osd_rnd_pilot: OSD_FORMS,
    sterile: ["Sterile Liquid (Vial)", "Sterile Liquid (Ampoule)", "Sterile Liquid (PFS)", "Sterile Liquid (Cartridge)", "Ophthalmic Drops", "Ophthalmic Ointment", "Dry Powder Reconstitution", "Implant"],
  };
  const DEV_STAGES = ["R&D Lab", "Pilot Plant"];
  const SCALE_SIZES = ["Small", "Medium", "Large"];

  const LIMITS = { nameMax: 120, notesMax: 2000, textMax: 2000, batchSizeMax: 120, numberAbsMax: 1e9, bodyBytesMax: 256 * 1024 };
  const INPUT_KEYS = ["category", "devStage", "specificForms", "targetMarkets", "primaryAuthority", "scaleSize", "batchSize", "selectedRooms", "facilityValues", "roomValues"];
  const PROJECT_KEYS = ["name", "notes", "inputs"];
  const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

  function resolveInputKind(param) {
    if (param.id === "DFS-003") return "number";
    const dt = (param.data_type || "").toLowerCase();
    if (dt.includes("boolean") && (dt.includes("text") || dt.includes("categorical"))) return "boolean-text";
    if (dt === "boolean") return "boolean";
    if (dt.startsWith("numeric range")) return "number-range";
    if (dt === "numeric") return "number";
    if (dt.includes("categorical")) return "select";
    return "text";
  }

  function defaultState() {
    return {
      step: 1, category: null, devStage: null, specificForms: [], targetMarkets: ["schedule_m"], primaryAuthority: "schedule_m",
      scaleSize: "Medium", batchSize: "", selectedRooms: [], facilityValues: {}, roomValues: {},
    };
  }

  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

  function serializeInputs(state) {
    const out = {};
    for (const k of INPUT_KEYS) out[k] = clone(state[k]);
    return out;
  }

  // ------------------------------------------------------------ validation

  const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));

  function findForbiddenKey(v, path) {
    if (v === null || typeof v !== "object") return null;
    for (const k of Object.keys(v)) {
      if (FORBIDDEN_KEYS.has(k)) return `${path}.${k}`;
      const deeper = findForbiddenKey(v[k], `${path}.${k}`);
      if (deeper) return deeper;
    }
    return null;
  }

  function checkKeys(obj, allowed, path, errors) {
    for (const k of Object.keys(obj)) if (!allowed.includes(k)) errors.push(`${path}: unknown key "${k}"`);
  }

  const isNum = (v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= LIMITS.numberAbsMax;
  const isNumOrNull = (v) => v === null || isNum(v);
  const isStr = (v, max) => typeof v === "string" && v.length <= max;
  const onlyKeys = (o, keys) => Object.keys(o).every((k) => keys.includes(k));

  // Returns the cleaned value, or undefined (after recording an error).
  function checkValue(param, v, path, errors) {
    if (v === null) return null;
    const bad = (why) => { errors.push(`${path} (${param.id}): ${why}`); return undefined; };
    switch (resolveInputKind(param)) {
      case "number":
        return isNum(v) ? v : bad("expected a finite number");
      case "number-range": {
        if (!isPlainObject(v) || !onlyKeys(v, ["min", "max"])) return bad("expected {min, max}");
        const min = v.min ?? null, max = v.max ?? null;
        return isNumOrNull(min) && isNumOrNull(max) ? { min, max } : bad("min/max must be finite numbers");
      }
      case "boolean":
        return typeof v === "boolean" ? v : bad("expected true/false");
      case "boolean-text": {
        if (!isPlainObject(v) || !onlyKeys(v, ["value", "text"])) return bad("expected {value, text}");
        if (!(v.value === undefined || v.value === null || typeof v.value === "boolean")) return bad("value must be true/false");
        if (v.text !== undefined && typeof v.text !== "string") return bad("text must be a string");
        if (v.text !== undefined && v.text.length > LIMITS.textMax) return bad("text too long");
        const o = {};
        if (v.value !== undefined) o.value = v.value;
        if (v.text !== undefined) o.text = v.text;
        return o;
      }
      default: // select / text
        if (typeof v !== "string") return bad("expected text");
        return v.length <= LIMITS.textMax ? v : bad("too long");
    }
  }

  function checkValueMap(map, DATA, path, errors) {
    if (!isPlainObject(map)) { errors.push(`${path}: expected an object`); return {}; }
    const out = {};
    for (const id of Object.keys(map)) {
      if (!hasOwn(DATA.paramById, id)) { errors.push(`${path}: unknown parameter id "${id}"`); continue; }
      const v = checkValue(DATA.paramById[id], map[id], `${path}.${id}`, errors);
      if (v !== undefined) out[id] = v;
    }
    return out;
  }

  function checkIdList(list, isKnown, path, errors) {
    if (!Array.isArray(list)) { errors.push(`${path}: expected a list`); return []; }
    const seen = new Set();
    for (const id of list) {
      if (typeof id !== "string" || !isKnown(id)) errors.push(`${path}: unknown value "${id}"`);
      else if (seen.has(id)) errors.push(`${path}: duplicate "${id}"`);
      seen.add(id);
    }
    return list.slice();
  }

  function validateInputs(raw, DATA) {
    if (!isPlainObject(raw)) return { ok: false, errors: ["inputs: expected an object"] };
    const forbidden = findForbiddenKey(raw, "inputs");
    if (forbidden) return { ok: false, errors: [`${forbidden}: forbidden key`] };
    const errors = [];
    checkKeys(raw, INPUT_KEYS, "inputs", errors);

    const d = defaultState();
    const val = (k) => (hasOwn(raw, k) ? raw[k] : d[k]);
    const out = {};

    out.category = val("category");
    if (out.category !== null && !hasOwn(SPECIFIC_FORMS, out.category)) errors.push(`category: unknown "${out.category}"`);
    const forms = hasOwn(SPECIFIC_FORMS, out.category) ? SPECIFIC_FORMS[out.category] : [];
    out.specificForms = checkIdList(val("specificForms"), (f) => forms.includes(f), "specificForms", errors);
    out.devStage = val("devStage");
    if (out.devStage !== null && !DEV_STAGES.includes(out.devStage)) errors.push(`devStage: unknown "${out.devStage}"`);
    // Authorities with no data in this dataset can no longer be chosen; older
    // saves that include one load without it (never rejected).
    const isAuthority = (k) => hasOwn(DATA.authorityByKey, k);
    const covered = (k) => isAuthority(k) && DATA.authorityByKey[k].covered !== false;
    const markets = val("targetMarkets");
    const droppable = (k) => typeof k === "string" && isAuthority(k) && !covered(k);
    out.targetMarkets = checkIdList(Array.isArray(markets) ? markets.filter((k) => !droppable(k)) : markets, isAuthority, "targetMarkets", errors);
    if (!hasOwn(raw, "primaryAuthority")) {
      out.primaryAuthority = out.targetMarkets.find(covered) || null; // saved before the field existed
    } else if (raw.primaryAuthority === null) {
      out.primaryAuthority = null; // the planner hasn't chosen yet; Step 1 asks before Next
    } else {
      const pa = raw.primaryAuthority;
      if (typeof pa !== "string" || !covered(pa) || !out.targetMarkets.includes(pa)) {
        errors.push(`primaryAuthority: "${String(pa).slice(0, 40)}" must be a covered authority chosen as a target market`);
      }
      out.primaryAuthority = pa;
    }
    out.scaleSize = val("scaleSize");
    if (!SCALE_SIZES.includes(out.scaleSize)) errors.push(`scaleSize: unknown "${out.scaleSize}"`);
    out.batchSize = val("batchSize");
    if (!isStr(out.batchSize, LIMITS.batchSizeMax)) errors.push(`batchSize: must be text of at most ${LIMITS.batchSizeMax} characters`);
    const isRoom = (id) => hasOwn(DATA.roomById, id);
    out.selectedRooms = checkIdList(val("selectedRooms"), isRoom, "selectedRooms", errors);
    out.facilityValues = checkValueMap(val("facilityValues"), DATA, "facilityValues", errors);

    out.roomValues = {};
    const rv = val("roomValues");
    if (!isPlainObject(rv)) errors.push("roomValues: expected an object");
    else {
      for (const roomId of Object.keys(rv)) {
        if (!isRoom(roomId)) { errors.push(`roomValues: unknown room id "${roomId}"`); continue; }
        out.roomValues[roomId] = checkValueMap(rv[roomId], DATA, `roomValues.${roomId}`, errors);
      }
    }

    return errors.length ? { ok: false, errors } : { ok: true, inputs: out };
  }

  function validateProject(raw, DATA) {
    if (!isPlainObject(raw)) return { ok: false, errors: ["project: expected an object"] };
    const forbidden = findForbiddenKey(raw, "project");
    if (forbidden) return { ok: false, errors: [`${forbidden}: forbidden key`] };
    const errors = [];
    checkKeys(raw, PROJECT_KEYS, "project", errors);
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name) errors.push("name: required");
    else if (name.length > LIMITS.nameMax) errors.push(`name: at most ${LIMITS.nameMax} characters`);
    const notes = raw.notes === undefined ? "" : raw.notes;
    if (!isStr(notes, LIMITS.notesMax)) errors.push(`notes: must be text of at most ${LIMITS.notesMax} characters`);
    const r = validateInputs(raw.inputs, DATA);
    if (!r.ok) errors.push(...r.errors);
    if (errors.length) return { ok: false, errors };
    const project = { name, notes, inputs: r.inputs };
    if (new TextEncoder().encode(JSON.stringify(project)).length > LIMITS.bodyBytesMax) {
      return { ok: false, errors: ["project: larger than 256 KB"] };
    }
    return { ok: true, project };
  }

  // Copy validated inputs into the app's existing state object, field by field.
  function resetState(state, inputs) {
    const fresh = defaultState();
    for (const k of Object.keys(state)) if (!hasOwn(fresh, k)) delete state[k];
    for (const k of Object.keys(fresh)) state[k] = fresh[k];
    if (inputs) for (const k of INPUT_KEYS) if (inputs[k] !== undefined) state[k] = clone(inputs[k]);
    return state;
  }

  // Keep the primary authority consistent with the chosen markets: a still-
  // selected choice stays; a single market is the obvious primary; otherwise
  // the planner is asked to choose (null).
  function ensurePrimary(state) {
    const markets = state.targetMarkets || [];
    if (markets.includes(state.primaryAuthority)) return state;
    state.primaryAuthority = markets.length === 1 ? markets[0] : null;
    return state;
  }

  // Change the dosage-form category without losing work: the old category's
  // forms, stage and rooms are set aside in `memory` and restored if the user
  // comes back (arrow keys move through the category radios one by one).
  function switchCategory(state, nextKey, memory) {
    if (state.category === nextKey) return state;
    if (state.category) {
      memory[state.category] = clone({ specificForms: state.specificForms, devStage: state.devStage, selectedRooms: state.selectedRooms });
    }
    const saved = hasOwn(memory, nextKey) ? clone(memory[nextKey]) : { specificForms: [], devStage: null, selectedRooms: [] };
    state.category = nextKey;
    state.specificForms = saved.specificForms;
    state.devStage = saved.devStage;
    state.selectedRooms = saved.selectedRooms;
    return state;
  }

  // Stable string of everything Save would store. Two equal fingerprints mean
  // "nothing to save"; used to warn about unsaved changes.
  function canonical(v) {
    if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
    if (v && typeof v === "object") return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
    return JSON.stringify(v === undefined ? null : v);
  }
  function fingerprint({ name, notes, state }) {
    return canonical({ name: String(name || "").trim(), notes: String(notes || ""), inputs: serializeInputs(state) });
  }

  return {
    CATEGORY_DEFS, SPECIFIC_FORMS, DEV_STAGES, SCALE_SIZES, LIMITS,
    resolveInputKind, defaultState, serializeInputs, validateInputs, validateProject, resetState, fingerprint, switchCategory, ensurePrimary,
  };
});
