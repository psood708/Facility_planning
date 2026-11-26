/* PDF intake — vocabulary. Every word that maps document text to the dataset:
 * categories, forms, authorities, rooms, parameter headers, cleanroom grades
 * and units. One editable place for the domain expert's wording.
 *
 * Kept out of data/ on purpose: data files are content-hashed into the
 * manifest, and changing them marks every saved project's results stale.
 * Every target here is checked against the dataset by tests/intake-match.test.js.
 * Browser: window.IntakeVocab; Node: module.exports.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod;
  else root.IntakeVocab = mod;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Lowercase, accents and dashes folded, "Δp" -> "dp", anything that isn't a
  // letter or digit becomes one space. Matching is always on whole tokens.
  function norm(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/[Δδ]\s*p\b/gi, "dp")
      .normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }
  const tokens = (s) => norm(s).split(" ").filter(Boolean);
  // Whole-token phrase search: does "eu gmp" occur in "for usfda and eu gmp markets"?
  const hasPhrase = (text, phrase) => {
    const t = ` ${norm(text)} `;
    const p = norm(phrase);
    return !!p && t.includes(` ${p} `);
  };

  // Dosage form category -> words that indicate it.
  const CATEGORY_WORDS = Object.freeze({
    sterile: ["sterile", "parenteral", "parenterals", "injectable", "injectables", "aseptic", "aseptically filled"],
    osd_production: ["oral solid dosage", "oral solid", "osd", "tablets", "capsules", "tablet manufacturing"],
    ext_prep: ["topical", "external preparation", "external preparations", "ointments", "creams", "semi solid", "semi solids"],
    osd_rnd_pilot: ["pilot plant", "r d lab", "formulation development", "development lab"],
  });

  // Short ways documents name a specific form -> the form's exact name.
  // The full names themselves are matched too (see formPhrases).
  const FORM_WORDS = Object.freeze({
    vial: "Sterile Liquid (Vial)", vials: "Sterile Liquid (Vial)",
    ampoule: "Sterile Liquid (Ampoule)", ampoules: "Sterile Liquid (Ampoule)", ampule: "Sterile Liquid (Ampoule)",
    pfs: "Sterile Liquid (PFS)", "prefilled syringe": "Sterile Liquid (PFS)", "pre filled syringe": "Sterile Liquid (PFS)", "prefilled syringes": "Sterile Liquid (PFS)",
    cartridge: "Sterile Liquid (Cartridge)", cartridges: "Sterile Liquid (Cartridge)",
    "eye drops": "Ophthalmic Drops", "eye ointment": "Ophthalmic Ointment",
    lyophilized: "Dry Powder Reconstitution", "dry powder for injection": "Dry Powder Reconstitution",
    implants: "Implant",
    "uncoated tablet": "Tablet (Uncoated)", "uncoated tablets": "Tablet (Uncoated)",
    "film coated tablet": "Tablet (Coated)", "coated tablets": "Tablet (Coated)",
    "extended release": "Tablet (Extended Release)", "er tablet": "Tablet (Extended Release)",
    "modified release": "Tablet (Modified Release)", "mr tablet": "Tablet (Modified Release)",
    "hard gelatin capsule": "Capsule", "mouth dissolving film": "MDF (Mouth Dissolving Film)", "oral film": "MDF (Mouth Dissolving Film)",
    "buccal film": "Buccal Film", "dusting powder": "Dusting Powder",
  });

  // Authority key -> extra names (the dataset's own labels are always matched too).
  const MARKET_WORDS = Object.freeze({
    schedule_m: ["schedule m", "revised schedule m", "cdsco"],
    us_fda: ["usfda", "us fda", "fda", "21 cfr", "cgmp"],
    eu_gmp: ["eu gmp", "eudralex", "annex 1", "ema"],
    uk_mhra: ["mhra", "uk mhra"],
    pics: ["pic s", "pics"],
    who_gmp: ["who gmp", "who trs", "who technical report"],
    tga_australia: ["tga"],
    china_nmpa: ["nmpa", "china gmp"],
    japan_pmda: ["pmda", "japan gmp"],
    sahpra: ["sahpra"],
    sfda: ["sfda", "saudi fda"],
  });

  // Development stage words -> DEV_STAGES value.
  const DEV_STAGE_WORDS = Object.freeze({ "pilot plant": "Pilot Plant", "r d lab": "R&D Lab", "research and development lab": "R&D Lab" });

  // Words documents use for a room that its dataset name doesn't contain.
  const ROOM_EXTRAS = Object.freeze({
    "filling room": "Z-29", "aseptic filling": "Z-29", "vial filling": "Z-29",
    "dispensary": "Z-07", "weighing booth": "Z-07", "dispensing booth": "Z-07",
    "sampling booth": "Z-06", "goods receipt": "Z-01", "receiving bay": "Z-01",
    "capping room": "Z-34", "crimping room": "Z-34", "lyo loading": "Z-35",
    "washing room": "Z-48", "autoclave room": "Z-49", "gowning room": "Z-51",
    "pass box": "Z-56", "dynamic pass box": "Z-56", "clean corridor": "Z-50",
  });
  // Tokens too common to tell rooms apart.
  const ROOM_STOP = new Set(["room", "area", "the", "and", "of", "for", "or", "zone", "suite"]);

  // Column headers -> what the column holds.
  const ROLE_WORDS = Object.freeze({
    room: ["room", "room name", "room no", "area name", "room area", "room zone", "location", "zone", "space", "room description"],
    param: ["parameter", "feature", "requirement", "attribute", "item", "description of parameter"],
    value: ["entered", "value", "design value", "design", "actual", "proposed", "specified", "specification", "design condition", "design basis"],
  });

  // Wide tables: a parameter's column header -> parameter id. Header words are
  // matched as whole tokens; the longest match wins.
  const PARAM_HEADERS = Object.freeze([
    ["area", "DIM-001"], ["net area", "DIM-001"], ["floor area", "DIM-001"], ["room area", "DIM-001"],
    ["length", "DIM-002"], ["width", "DIM-003"], ["height", "DIM-004"], ["clear height", "DIM-004"], ["ceiling height", "DIM-004"],
    ["corridor width", "DIM-005"],
    ["grade", "HVAC-001"], ["class", "HVAC-001"], ["iso class", "HVAC-001"], ["cleanliness", "HVAC-001"], ["cleanroom class", "HVAC-001"], ["classification", "HVAC-001"],
    ["temp", "HVAC-002"], ["temperature", "HVAC-002"], ["db", "HVAC-002"], ["dry bulb", "HVAC-002"],
    ["rh", "HVAC-003"], ["humidity", "HVAC-003"], ["relative humidity", "HVAC-003"],
    ["ach", "HVAC-004"], ["air changes", "HVAC-004"], ["air change", "HVAC-004"],
    ["dp", "HVAC-005"], ["pressure", "HVAC-005"], ["differential pressure", "HVAC-005"], ["room pressure", "HVAC-005"],
    ["filtration", "HVAC-007"], ["filters", "HVAC-007"],
    ["hepa efficiency", "HVAC-008"], ["udaf velocity", "HVAC-009"], ["airflow velocity", "HVAC-009"], ["recovery time", "HVAC-010"],
    ["lux", "LGT-001"], ["illumination", "LGT-001"], ["lighting", "LGT-001"],
    ["airlock type", "FLOW-001"], ["interlock", "FLOW-002"], ["barrier", "DFS-004"], ["oeb", "SHE-004"],
  ]);

  // Units: [token phrase, multiplier to the dataset unit (or a function), dataset unit, label shown when converted].
  const UNITS = Object.freeze({
    area: [["sq ft", 0.092903, "sq ft"], ["sqft", 0.092903, "sq ft"], ["ft2", 0.092903, "sq ft"], ["square feet", 0.092903, "sq ft"],
      ["m2", 1], ["sq m", 1], ["sqm", 1], ["square metre", 1], ["square meter", 1], ["rn2", 1]],
    temperature: [["f", (v) => ((v - 32) * 5) / 9, "°F"], ["deg f", (v) => ((v - 32) * 5) / 9, "°F"], ["c", 1], ["deg c", 1], ["oc", 1]],
    pressure: [["mmwc", 9.80665, "mmWC"], ["mm wc", 9.80665, "mmWC"], ["mmwg", 9.80665, "mmWG"], ["inwc", 249.089, "inWC"], ["in wc", 249.089, "inWC"], ["pa", 1], ["pascal", 1], ["pascals", 1]],
    length: [["ft", 0.3048, "ft"], ["feet", 0.3048, "ft"], ["mm", 0.001, "mm"], ["m", 1]],
  });
  // Which unit family a parameter's numbers belong to.
  const UNIT_FAMILY = Object.freeze({ "DIM-001": "area", "SHE-007": "area", "HVAC-002": "temperature", "HVAC-005": "pressure", "DIM-002": "length", "DIM-003": "length", "DIM-004": "length", "DIM-005": "length" });
  // Which parameter a unit implies on a short free line or drawing label.
  const UNIT_PARAM = Object.freeze([["m2", "DIM-001"], ["m²", "DIM-001"], ["sq m", "DIM-001"], ["sqm", "DIM-001"], ["sq ft", "DIM-001"], ["c", "HVAC-002"], ["rh", "HVAC-003"], ["pa", "HVAC-005"], ["ach", "HVAC-004"], ["lux", "LGT-001"]]);

  // Cleanroom grade wording -> the exact Step 3 option.
  const GRADES = Object.freeze([
    ["grade a", "Grade A (ISO 5)"], ["iso 5", "Grade A (ISO 5)"], ["iso class 5", "Grade A (ISO 5)"], ["class 100", "Grade A (ISO 5)"], ["iso 5 grade a", "Grade A (ISO 5)"],
    ["grade b", "Grade B"], ["iso 7 at rest", "Grade B"],
    ["grade c", "Grade C (ISO 7)"], ["iso 7", "Grade C (ISO 7)"], ["iso class 7", "Grade C (ISO 7)"], ["class 10000", "Grade C (ISO 7)"], ["class 10 000", "Grade C (ISO 7)"],
    ["grade d", "Grade D (ISO 8)"], ["iso 8", "Grade D (ISO 8)"], ["iso class 8", "Grade D (ISO 8)"], ["class 100000", "Grade D (ISO 8)"], ["class 100 000", "Grade D (ISO 8)"],
    ["unclassified", "Unclassified/CNC"], ["cnc", "Unclassified/CNC"], ["controlled not classified", "Unclassified/CNC"], ["unclassified cnc", "Unclassified/CNC"], ["non classified", "Unclassified/CNC"],
  ]);

  const BOOLEAN_WORDS = Object.freeze({
    true: ["yes", "y", "true", "required", "provided", "present", "available", "exists", "applicable", "installed"],
    false: ["no", "n", "false", "not required", "not provided", "none", "absent", "not applicable", "na"],
  });

  // Room phrases: the full name, each " / " part, and the part before "(",
  // plus ROOM_EXTRAS. [{ roomId, phrase, toks, full }]
  function roomPhrases(DATA) {
    const out = [];
    const add = (roomId, phrase, full) => {
      const toks = tokens(phrase).filter((t) => !ROOM_STOP.has(t));
      if (toks.length) out.push({ roomId, phrase, toks, full });
    };
    for (const r of DATA.rooms || []) {
      add(r.id, r.name, true);
      const base = r.name.split("(")[0];
      if (base !== r.name) add(r.id, base, false);
      for (const part of r.name.split("/")) if (part.trim() && part !== r.name) add(r.id, part.split("(")[0], false);
    }
    for (const [phrase, id] of Object.entries(ROOM_EXTRAS)) add(id, phrase, false);
    return out;
  }

  // Parameter phrases: each parameter's name and its " / " parts, plus the
  // checklist (boolean threshold) names, which point at their linked parameter.
  function paramPhrases(DATA) {
    const out = [];
    const skip = /^(CLASS|COMP)-/; // classification is Step 1; compliance fields are outputs
    const add = (paramId, phrase, full) => { const toks = tokens(phrase); if (toks.length) out.push({ paramId, phrase, toks, full }); };
    for (const p of DATA.parameters || []) {
      if (skip.test(p.id)) continue;
      add(p.id, p.name, true);
      add(p.id, p.name.replace(/\([^)]*\)/g, " "), false);
      for (const part of p.name.split(" / ")) if (part !== p.name) add(p.id, part, false);
    }
    for (const b of DATA.boolean_thresholds || []) if (b.linked_param_id && b.parameter_name) add(b.linked_param_id, b.parameter_name, true);
    return out;
  }

  function formPhrases(SPECIFIC_FORMS) {
    const out = [];
    for (const form of [...new Set(Object.values(SPECIFIC_FORMS).flat())]) out.push([form, form]);
    for (const [phrase, form] of Object.entries(FORM_WORDS)) out.push([phrase, form]);
    return out;
  }

  return {
    norm, tokens, hasPhrase,
    CATEGORY_WORDS, FORM_WORDS, MARKET_WORDS, DEV_STAGE_WORDS, ROOM_EXTRAS, ROLE_WORDS, PARAM_HEADERS,
    UNITS, UNIT_FAMILY, UNIT_PARAM, GRADES, BOOLEAN_WORDS,
    roomPhrases, paramPhrases, formPhrases,
  };
});
