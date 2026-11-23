/* Facility Compliance rules engine — pure evaluation logic, no DOM.
 * Loaded by the browser (exposes window.FacilityEngine) and by Node tests
 * (module.exports). Every function takes the loaded DATA and the wizard state
 * explicitly instead of reading globals, so it can be tested in isolation.
 */
(function (root, factory) {
  const engine = factory();
  if (typeof module === "object" && module.exports) module.exports = engine;
  else root.FacilityEngine = engine;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const GRADE_HIERARCHY = ["Unclassified/CNC", "Grade D (ISO 8)", "Grade C (ISO 7)", "Grade B", "Grade A (ISO 5)"];
  const GRADE_TAG_TO_LABEL = { A: "Grade A (ISO 5)", B: "Grade B", C: "Grade C (ISO 7)", D: "Grade D (ISO 8)", Unclassified: "Unclassified/CNC", Controlled: "Unclassified/CNC", Technical: "Unclassified/CNC" };

  const SEVERITY_RANK = { Critical: 4, Significant: 3, Partial: 2, Aligned: 1, Varies: 2 };

  // Provenance / fallback (PRD milestone 1). Citations are never invented: a
  // benchmark without an expert-supplied citation says so explicitly.
  const PENDING_CITATION = "Citation pending expert review";
  const FALLBACK_DATA_KEY = "industry";
  const FALLBACK_LABEL = "International/industry standard (fallback)";
  const GRADE_SOURCE = "Room-Zone Master List (source workbook) — designated grade synthesized across authorities";
  const OBLIGATION_RANK = { mandatory: 2, recommended: 1, unclassified: 0 };

  // Parameters that are captured but never scored pass/fail (free-text / structural).
  const NON_SCORED_CATEGORY_EXCLUDE = ["Classification", "Compliance Output"];

  // Restrict a handful of parameters to the rooms they actually apply to
  // (their schema-level applicability is broader than a single room type).
  const PARAM_ROOM_FILTERS = {
    "DFS-003": (room) => /MDF|Buccal/i.test(room.name),
    "DFS-004": (room) => room.process_stage === "Filling",
    "DFS-007": (room) => /Implant/i.test(room.name),
    "SHE-003": (room) => /Granulat|Compress|Blend|Coat|Dust|Powder/i.test(room.name),
    "DFS-001": (room) => /Dust|Powder|Granulat|Blend/i.test(room.name),
    "DFS-002": (room) => /Liquid|Emulsion|Suspension|Coating/i.test(room.name),
    "HVAC-009": (room) => room.grade_tag === "A",
    "HVAC-010": (room) => room.grade_tag === "A" || room.grade_tag === "B",
    "DIM-005": (room) => /Corridor|Buffer/i.test(room.process_stage),
    "DIM-006": (room) => /Airlock|Hatch|Gowning/i.test(room.process_stage + " " + room.name),
    "FLOW-001": (room) => /Airlock|Hatch|Gowning/i.test(room.process_stage + " " + room.name),
    "FLOW-002": (room) => /Airlock|Hatch|Gowning/i.test(room.process_stage + " " + room.name),
  };

  // -------------------------------------------------------------------
  // Data indexing
  // -------------------------------------------------------------------

  function indexData(data) {
    data.paramById = Object.fromEntries(data.parameters.map((p) => [p.id, p]));
    data.roomById = Object.fromEntries(data.rooms.map((r) => [r.id, r]));
    data.authorityByKey = Object.fromEntries(data.authorities.map((a) => [a.key, a]));
    return data;
  }

  // -------------------------------------------------------------------
  // Parameter / threshold lookup
  // -------------------------------------------------------------------

  function relevantParams(DATA, state) {
    return DATA.parameters.filter((p) => !NON_SCORED_CATEGORY_EXCLUDE.includes(p.category) && p.applicability[state.category]);
  }

  function appliesAtNormalized(param) {
    return param.applies_at === "Room" ? "room" : "facility";
  }

  function resolveContext(state, paramId, room) {
    if (paramId === "HVAC-002" || paramId === "HVAC-003") {
      return room.grade_tag === "A" || room.grade_tag === "B" ? "sterile_filling" : "non_sterile_manufacturing";
    }
    if (paramId === "HVAC-004") {
      if (room.grade_tag === "B" || room.grade_tag === "A") return "grade_b";
      if (room.grade_tag === "C") return "grade_c";
      if (room.grade_tag === "D") return "grade_d";
      return "non_sterile_production";
    }
    if (paramId === "HVAC-005") {
      return state.category === "sterile" ? "between_adjacent_grades" : "non_sterile";
    }
    if (paramId === "HVAC-009") return "grade_a";
    if (paramId === "LGT-001") {
      if (/Inspection/i.test(room.name)) return "inspection";
      if (["Storage", "Store", "Hold", "Receiving"].includes(room.process_stage)) return "storage";
      if ((room.grade_tag === "A" || room.grade_tag === "B") && room.process_stage === "Filling") return "filling_area";
      return "general_processing";
    }
    return "all";
  }

  function getThresholdsFor(DATA, state, paramId, room) {
    const ctx = room ? resolveContext(state, paramId, room) : "all";
    return DATA.thresholds.filter((t) => t.linked_param_id === paramId && (t.context === "all" || t.context === ctx));
  }

  function authorityDataKey(DATA, marketKey) {
    const a = DATA.authorityByKey[marketKey];
    return a ? a.data_key : null;
  }

  function marketLabel(DATA, mk) {
    const a = DATA.authorityByKey[mk];
    return a ? a.label : mk;
  }

  function labelList(DATA, keys) {
    return keys.map((k) => marketLabel(DATA, k)).join(", ");
  }

  // -------------------------------------------------------------------
  // Provenance
  // -------------------------------------------------------------------

  // Citation + mandatory/recommended label for one benchmark under one authority.
  // `defaults.citation` supplies a source already present in the data (e.g. the
  // workbook's Schedule M room-area text); an expert citation in provenance.json wins.
  function lookupProvenance(DATA, benchmarkId, dataKey, defaults = {}) {
    const entries = (DATA.provenance && DATA.provenance.entries) || {};
    const entry = (entries[benchmarkId] || {})[dataKey] || {};
    const citation = entry.citation || defaults.citation || null;
    return {
      citation,
      citationLabel: citation || PENDING_CITATION,
      citationStatus: entry.citation_status || (citation ? "workbook" : "pending"),
      obligation: entry.obligation || "unclassified",
      obligationStatus: entry.obligation_status || "unclassified",
      draftBasis: entry.draft_basis || null,
      reviewedBy: entry.reviewed_by || null,
      reviewedOn: entry.reviewed_on || null,
    };
  }

  // -------------------------------------------------------------------
  // Core evaluation
  // -------------------------------------------------------------------

  function isBlank(v) {
    return v === null || v === undefined || v === "";
  }

  // Compare an entered value against one benchmark entry ({min,max} or {category}).
  function checkAgainst(threshold, entry, enteredValue) {
    if (threshold.type === "categorical") {
      const hierarchy = threshold.hierarchy;
      const enteredIdx = hierarchy.indexOf(enteredValue);
      const reqIdx = hierarchy.indexOf(entry.category);
      const compliant = enteredIdx >= 0 && enteredIdx >= reqIdx;
      return { status: compliant ? "compliant" : "non_compliant", required: entry.category, note: entry.note };
    }
    const isRange = typeof enteredValue === "object";
    // Guard against JS's null <= N === true coercion: a range bound left blank must not
    // silently read as compliant just because null coerces to 0 in a relational comparison.
    const okMin = entry.min == null || (isRange ? enteredValue.min != null && enteredValue.min >= entry.min : enteredValue >= entry.min);
    const okMax = entry.max == null || (isRange ? enteredValue.max != null && enteredValue.max <= entry.max : enteredValue <= entry.max);
    return { status: okMin && okMax ? "compliant" : "non_compliant", min: entry.min, max: entry.max, note: entry.note };
  }

  // The international/industry-standard entry, if the dataset has a value for it.
  function fallbackEntry(threshold) {
    const e = threshold.authorities && threshold.authorities[FALLBACK_DATA_KEY];
    return e && e.covered && e.specified ? e : null;
  }

  function fallbackReference(entry) {
    return { min: entry.min ?? null, max: entry.max ?? null, required: entry.category ?? null, note: entry.note || null, label: FALLBACK_LABEL };
  }

  // A conflict means no single value can satisfy every selected authority
  // (numeric ranges that do not overlap). Ordered categories never conflict —
  // the stricter class satisfies both.
  function detectConflict(threshold, specifiedMarkets) {
    if (threshold.type === "categorical" || specifiedMarkets.length < 2) return null;
    const mins = specifiedMarkets.map(({ authEntry }) => authEntry.min).filter((v) => v != null);
    const maxes = specifiedMarkets.map(({ authEntry }) => authEntry.max).filter((v) => v != null);
    if (!mins.length || !maxes.length || Math.max(...mins) <= Math.min(...maxes)) return null;
    const fb = fallbackEntry(threshold);
    return {
      markets: specifiedMarkets.map(({ marketKey }) => marketKey),
      reference: fb ? fallbackReference(fb) : null,
    };
  }

  function evaluateNumericOrCategorical(DATA, threshold, enteredValue, marketKeys) {
    const perMarket = {};
    const specifiedMarkets = []; // { marketKey, dataKey, authEntry }
    const unspecifiedMarkets = [];
    const hasValue = !isBlank(enteredValue);
    const fb = fallbackEntry(threshold);

    marketKeys.forEach((mk) => {
      const dataKey = authorityDataKey(DATA, mk);
      if (!dataKey) {
        perMarket[mk] = { status: "not_covered" };
        return;
      }
      const authEntry = threshold.authorities[dataKey];
      if (!authEntry || !authEntry.specified) {
        perMarket[mk] = { status: "not_regulated", note: authEntry ? authEntry.note : null };
        unspecifiedMarkets.push(mk);
        return;
      }
      specifiedMarkets.push({ marketKey: mk, dataKey, authEntry });
    });

    specifiedMarkets.forEach(({ marketKey, dataKey, authEntry }) => {
      const result = hasValue ? checkAgainst(threshold, authEntry, enteredValue) : { status: "no_value" };
      result.provenance = lookupProvenance(DATA, threshold.id, dataKey);
      perMarket[marketKey] = result;
    });

    // The authority gives no number: its verdict stays "not_regulated", and the
    // fallback standard is evaluated alongside it as advisory guidance only.
    if (fb) {
      unspecifiedMarkets.forEach((mk) => {
        const check = hasValue ? checkAgainst(threshold, fb, enteredValue) : { status: "no_value" };
        perMarket[mk].fallback = { ...fallbackReference(fb), status: check.status, obligation: "recommended" };
      });
    }

    return { perMarket, hasValue, conflict: detectConflict(threshold, specifiedMarkets) };
  }

  function strictestBound(DATA, threshold, marketKeys) {
    // Returns { min, max, drivingMin: [marketKeys], drivingMax: [marketKeys] } across specified+selected markets
    let min = null, max = null;
    let drivingMin = [], drivingMax = [];
    marketKeys.forEach((mk) => {
      const dataKey = authorityDataKey(DATA, mk);
      if (!dataKey) return;
      const a = threshold.authorities[dataKey];
      if (!a || !a.specified) return;
      if (a.min != null) {
        if (min === null || a.min > min) { min = a.min; drivingMin = [mk]; }
        else if (a.min === min) drivingMin.push(mk);
      }
      if (a.max != null) {
        if (max === null || a.max < max) { max = a.max; drivingMax = [mk]; }
        else if (a.max === max) drivingMax.push(mk);
      }
    });
    return { min, max, drivingMin, drivingMax };
  }

  function strictestCategory(DATA, threshold, marketKeys) {
    let best = null, driving = [];
    marketKeys.forEach((mk) => {
      const dataKey = authorityDataKey(DATA, mk);
      if (!dataKey) return;
      const a = threshold.authorities[dataKey];
      if (!a || !a.specified) return;
      const idx = threshold.hierarchy.indexOf(a.category);
      const bestIdx = best === null ? -1 : threshold.hierarchy.indexOf(best);
      if (idx > bestIdx) { best = a.category; driving = [mk]; }
      else if (idx === bestIdx) driving.push(mk);
    });
    return { category: best, driving };
  }

  // -------------------------------------------------------------------
  // Result assembly
  // -------------------------------------------------------------------

  function buildEvaluationRows(DATA, state) {
    // Each row: { scope: 'facility'|room object, param, threshold, entered, evalResult }
    const rows = [];
    const params = relevantParams(DATA, state);
    const facilityParams = params.filter((p) => appliesAtNormalized(p) === "facility");
    const roomParams = params.filter((p) => appliesAtNormalized(p) === "room");
    const selectedRooms = state.selectedRooms.map((id) => DATA.roomById[id]).filter(Boolean);

    facilityParams.forEach((p) => {
      const thresholds = getThresholdsFor(DATA, state, p.id, null);
      thresholds.forEach((t) => {
        const entered = state.facilityValues[p.id];
        const evalResult = evaluateNumericOrCategorical(DATA, t, entered, state.targetMarkets);
        rows.push({ scope: "facility", room: null, param: p, threshold: t, entered, evalResult });
      });
    });

    selectedRooms.forEach((room) => {
      roomParams.forEach((p) => {
        const filter = PARAM_ROOM_FILTERS[p.id];
        if (filter && !filter(room)) return;
        const thresholds = getThresholdsFor(DATA, state, p.id, room);
        thresholds.forEach((t) => {
          const entered = (state.roomValues[room.id] || {})[p.id];
          const evalResult = evaluateNumericOrCategorical(DATA, t, entered, state.targetMarkets);
          rows.push({ scope: "room", room, param: p, threshold: t, entered, evalResult });
        });
      });

      // Room Net Area special-case (Schedule M only — the only sourced number)
      const enteredArea = (state.roomValues[room.id] || {})["DIM-001"];
      if (room.min_area_sqm != null) {
        const perMarket = {};
        state.targetMarkets.forEach((mk) => {
          if (mk === "schedule_m") {
            if (enteredArea === null || enteredArea === undefined || enteredArea === "") perMarket[mk] = { status: "no_value" };
            else perMarket[mk] = { status: enteredArea >= room.min_area_sqm ? "compliant" : "non_compliant", min: room.min_area_sqm };
            perMarket[mk].provenance = lookupProvenance(DATA, "AREA-" + room.id, "schedule_m", { citation: room.min_area_source });
          } else {
            const dataKey = authorityDataKey(DATA, mk);
            perMarket[mk] = dataKey ? { status: "not_regulated", note: "No authority-specific room-area figure in this dataset" } : { status: "not_covered" };
          }
        });
        rows.push({
          scope: "room", room,
          param: { id: "DIM-001-area", name: "Room Net Area", category: "Dimensional", gap_severity: "Significant" },
          threshold: { id: "AREA-" + room.id, type: "numeric", unit: "m²", severity: "Significant", source: "schedule_m_notes", authorities: {} },
          entered: enteredArea, evalResult: { perMarket, hasValue: enteredArea != null },
          areaOverride: { min: room.min_area_sqm, source: room.min_area_source },
        });
      }

      // Cleanroom Grade special-case: no authority-by-authority data exists for this in the
      // source workbook — instead, each room already carries its own expected grade (Room-Zone
      // Master List), synthesized across authorities. Compliant if entered grade >= that room's
      // expected grade, on the Unclassified<D<C<B<A hierarchy. Applies uniformly across whichever
      // markets are selected, since it is not an authority-differentiated check in this dataset.
      const gradeParam = DATA.paramById["HVAC-001"];
      if (gradeParam && gradeParam.applicability[state.category]) {
        const enteredGrade = (state.roomValues[room.id] || {})["HVAC-001"];
        const requiredLabel = GRADE_TAG_TO_LABEL[room.grade_tag] || "Unclassified/CNC";
        const reqIdx = GRADE_HIERARCHY.indexOf(requiredLabel);
        const perMarket = {};
        state.targetMarkets.forEach((mk) => {
          const dataKey = authorityDataKey(DATA, mk);
          if (!dataKey) { perMarket[mk] = { status: "not_covered" }; return; }
          const provenance = lookupProvenance(DATA, "GRADE-" + room.id, dataKey, { citation: GRADE_SOURCE });
          if (enteredGrade === null || enteredGrade === undefined || enteredGrade === "") { perMarket[mk] = { status: "no_value", provenance }; return; }
          const enteredIdx = GRADE_HIERARCHY.indexOf(enteredGrade);
          perMarket[mk] = { status: enteredIdx >= reqIdx ? "compliant" : "non_compliant", required: requiredLabel, provenance };
        });
        rows.push({
          scope: "room", room,
          param: gradeParam,
          threshold: { id: "GRADE-" + room.id, type: "categorical", hierarchy: GRADE_HIERARCHY, severity: "Significant", source: "room_zone_master_list", authorities: {} },
          entered: enteredGrade, evalResult: { perMarket, hasValue: !!enteredGrade },
          gradeOverride: { required: requiredLabel },
        });
      }
    });

    return rows;
  }

  function buildBooleanRows(DATA, state) {
    const rows = [];
    const selectedRooms = state.selectedRooms.map((id) => DATA.roomById[id]).filter(Boolean);

    DATA.boolean_thresholds.forEach((bt) => {
      const param = DATA.paramById[bt.linked_param_id];
      if (!param || !param.applicability[state.category]) return;
      const atFacility = appliesAtNormalized(param) === "facility";
      // Boolean requirements in this dataset are Schedule M-derived (schedule_m_explicit).
      const provenance = lookupProvenance(DATA, bt.id, "schedule_m");
      if (atFacility) {
        const v = state.facilityValues[param.id];
        const val = typeof v === "object" && v !== null ? v.value : v;
        let status = "no_value";
        if (val === true) status = "compliant";
        else if (val === false) status = "non_compliant";
        rows.push({ room: null, threshold: bt, param, entered: val, status, provenance });
      } else {
        selectedRooms.forEach((room) => {
          const filter = PARAM_ROOM_FILTERS[param.id];
          if (filter && !filter(room)) return;
          const v = (state.roomValues[room.id] || {})[param.id];
          const val = typeof v === "object" && v !== null ? v.value : v;
          let status = "no_value";
          if (val === true) status = "compliant";
          else if (val === false) status = "non_compliant";
          rows.push({ room, threshold: bt, param, entered: val, status, provenance });
        });
      }
    });
    return rows;
  }

  function computeMarketRollup(DATA, state, rows) {
    const rollup = {};
    state.targetMarkets.forEach((mk) => {
      const dataKey = authorityDataKey(DATA, mk);
      if (!dataKey) { rollup[mk] = "Not Covered by Dataset"; return; }
      let worst = null;
      let anyDefinitive = false;
      rows.forEach((row) => {
        const r = row.evalResult.perMarket[mk];
        if (!r) return;
        if (r.status === "compliant" || r.status === "non_compliant") anyDefinitive = true;
        if (r.status === "non_compliant") {
          const sev = row.threshold.severity || (row.param && row.param.gap_severity) || "Partial";
          const rank = SEVERITY_RANK[sev] ?? 2;
          if (worst === null || rank > worst.rank) worst = { rank, sev };
        }
      });
      if (worst && worst.rank >= 4) rollup[mk] = "Non-Compliant";
      else if (worst) rollup[mk] = "Partial";
      else if (!anyDefinitive) rollup[mk] = "Insufficient Data";
      else rollup[mk] = "Compliant";
    });
    return rollup;
  }

  // Strongest label among the results that produced a gap (mandatory > recommended > unclassified).
  function strongestObligation(results) {
    return results.reduce((best, r) => {
      const o = (r.provenance && r.provenance.obligation) || "unclassified";
      return OBLIGATION_RANK[o] > OBLIGATION_RANK[best] ? o : best;
    }, "unclassified");
  }

  // "draft" if any result behind the label is still a draft; "unclassified" when there is no label.
  function obligationStatusFor(results, obligation) {
    if (obligation === "unclassified") return "unclassified";
    const drafts = results.some((r) => r.provenance && r.provenance.obligation === obligation && r.provenance.obligationStatus === "draft");
    return drafts ? "draft" : "expert_confirmed";
  }

  function uniqueCitations(results) {
    return [...new Set(results.map((r) => (r.provenance ? r.provenance.citationLabel : PENDING_CITATION)))];
  }

  function enteredText(entered) {
    return typeof entered === "object" && entered !== null ? `${entered.min}–${entered.max}` : entered;
  }

  // Advisory suggestion for a row where no selected authority failed, but the
  // value misses the fallback standard for an authority that gives no number.
  function fallbackRecommendation(DATA, state, row, severity, roomLabel) {
    const markets = state.targetMarkets.filter((mk) => {
      const r = row.evalResult.perMarket[mk];
      return r && r.fallback && r.fallback.status === "non_compliant";
    });
    if (!markets.length) return null;
    const fb = row.evalResult.perMarket[markets[0]].fallback;
    const unit = row.threshold.unit ? ` ${row.threshold.unit}` : "";
    const why = `to meet the international/industry standard (fallback; not specified by ${labelList(DATA, markets)})`;
    let change;
    if (fb.required) change = `Upgrade ${row.param.name}${roomLabel} from '${row.entered}' to '${fb.required}'`;
    else if (fb.min != null && fb.max != null) change = `Adjust ${row.param.name}${roomLabel} from ${enteredText(row.entered)} to fall within ${fb.min}–${fb.max}${unit}`;
    else if (fb.min != null) change = `Increase ${row.param.name}${roomLabel} from ${enteredText(row.entered)} to at least ${fb.min}${unit}`;
    else change = `Decrease ${row.param.name}${roomLabel} from ${enteredText(row.entered)} to at most ${fb.max}${unit}`;
    return {
      severity,
      text: `${change} ${why}.${fb.note ? ` Reference: ${fb.note}.` : ""}`,
      id: row.threshold.id + (row.room ? "-" + row.room.id : ""),
      basis: "fallback",
      obligation: "recommended",
      obligationStatus: "fixed", // fallback guidance is never a requirement, by rule
      citations: [FALLBACK_LABEL + (fb.note ? ` — ${fb.note}` : "")],
    };
  }

  function buildRecommendations(DATA, state, rows) {
    const recs = [];
    rows.forEach((row) => {
      const failingMarkets = state.targetMarkets.filter((mk) => {
        const r = row.evalResult.perMarket[mk];
        return r && r.status === "non_compliant";
      });
      const severity = row.threshold.severity || (row.param && row.param.gap_severity) || "Partial";
      const roomLabel = row.room ? ` in '${row.room.name}'` : "";
      if (!failingMarkets.length) {
        const fbRec = fallbackRecommendation(DATA, state, row, severity, roomLabel);
        if (fbRec) recs.push(fbRec);
        return;
      }
      const failingResults = failingMarkets.map((mk) => row.evalResult.perMarket[mk]);
      let text;

      if (row.areaOverride) {
        text = `Increase Room Net Area${roomLabel} from ${row.entered} m² to at least ${row.areaOverride.min} m² to satisfy ${row.areaOverride.source}.`;
      } else if (row.gradeOverride) {
        text = `Upgrade Cleanroom Grade${roomLabel} from '${row.entered ?? "not entered"}' to '${row.gradeOverride.required}' — this is this room's designated grade per the Room-Zone Master List.`;
      } else if (row.threshold.type === "categorical") {
        const { category, driving } = strictestCategory(DATA, row.threshold, failingMarkets.length ? failingMarkets : state.targetMarkets);
        text = `Upgrade ${row.param.name}${roomLabel} from '${row.entered}' to '${category}' to meet ${labelList(DATA, driving)}'s classification requirement.`;
      } else {
        const { min, max, drivingMin, drivingMax } = strictestBound(DATA, row.threshold, failingMarkets.length ? failingMarkets : state.targetMarkets);
        const unit = row.threshold.unit || "";
        const enteredDisplay = typeof row.entered === "object" ? `${row.entered.min}–${row.entered.max}` : row.entered;
        if (min != null && max != null) {
          text = `Adjust ${row.param.name}${roomLabel} from ${enteredDisplay} to fall within ${min}–${max} ${unit} to satisfy ${labelList(DATA, [...new Set([...drivingMin, ...drivingMax])])}.`;
        } else if (min != null) {
          text = `Increase ${row.param.name}${roomLabel} from ${enteredDisplay} to at least ${min} ${unit} to satisfy ${labelList(DATA, drivingMin)}.`;
        } else if (max != null) {
          text = `Decrease ${row.param.name}${roomLabel} from ${enteredDisplay} to at most ${max} ${unit} to satisfy ${labelList(DATA, drivingMax)}.`;
        } else {
          text = `Review ${row.param.name}${roomLabel} — currently non-compliant with ${labelList(DATA, failingMarkets)}.`;
        }
      }
      const obligation = strongestObligation(failingResults);
      recs.push({
        severity, text,
        id: row.threshold.id + (row.room ? "-" + row.room.id : ""),
        basis: "authority",
        obligation,
        obligationStatus: obligationStatusFor(failingResults, obligation),
        citations: uniqueCitations(failingResults),
      });
    });

    // Boolean-required checks
    const booleanRows = buildBooleanRows(DATA, state);
    booleanRows.forEach((row) => {
      if (row.status !== "non_compliant") return;
      const roomLabel = row.room ? ` in '${row.room.name}'` : "";
      recs.push({
        severity: row.threshold.severity,
        text: `Add ${row.threshold.parameter_name}${roomLabel} — ${row.threshold.note}`,
        id: row.threshold.id + (row.room ? "-" + row.room.id : ""),
        basis: "authority",
        obligation: row.provenance.obligation,
        obligationStatus: row.provenance.obligationStatus,
        citations: [row.provenance.citationLabel],
      });
    });

    // Authority gaps first, advisory fallback suggestions after; severity within each.
    const basisRank = (r) => (r.basis === "fallback" ? 1 : 0);
    recs.sort((a, b) => basisRank(a) - basisRank(b) || (SEVERITY_RANK[b.severity] ?? 2) - (SEVERITY_RANK[a.severity] ?? 2));
    return recs;
  }

  function checkStructuralFlags(DATA, state) {
    const active = [];
    DATA.structural_flags.forEach((f) => {
      if (f.trigger.specific_dosage_form_any_of) {
        const hit = f.trigger.specific_dosage_form_any_of.some((form) => state.specificForms.some((sf) => sf.includes(form) || form.includes(sf)));
        if (hit) active.push(f);
      }
      if (f.trigger.facility_development_stage_any_of) {
        if (state.devStage && f.trigger.facility_development_stage_any_of.includes(state.devStage)) active.push(f);
      }
    });
    return active;
  }

  return {
    GRADE_HIERARCHY,
    GRADE_TAG_TO_LABEL,
    SEVERITY_RANK,
    PENDING_CITATION,
    FALLBACK_LABEL,
    NON_SCORED_CATEGORY_EXCLUDE,
    PARAM_ROOM_FILTERS,
    indexData,
    relevantParams,
    appliesAtNormalized,
    resolveContext,
    getThresholdsFor,
    authorityDataKey,
    marketLabel,
    labelList,
    lookupProvenance,
    evaluateNumericOrCategorical,
    strictestBound,
    strictestCategory,
    buildEvaluationRows,
    buildBooleanRows,
    computeMarketRollup,
    buildRecommendations,
    checkStructuralFlags,
  };
});
