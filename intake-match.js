/* PDF intake — matching. Turns a read document into proposed values
 * ("candidates"), groups and checks them against the current project
 * ("resolve"), and builds validated wizard inputs from the ones the planner
 * accepts ("buildInputs"). Pure: no DOM; nothing here writes app state.
 *
 * Extractor contract (an AI extractor can implement the same shape later):
 *   extractor = { id, label, run(doc, { DATA }) -> Candidate[] }
 *   doc = { name, pages: [{ index, source: "text"|"ocr", lines: DocLines.toLines(items) }] }
 *   Candidate = { target, value, display, source: { page, text }, confidence, reason, converted }
 *     target: { kind: "category" | "form" | "devStage" | "market" | "note" }
 *           | { kind: "room", roomId }
 *           | { kind: "param", scope: "facility", paramId }
 *           | { kind: "param", scope: "room", roomId, paramId }
 *     confidence: "high" | "medium" | "low"
 * Document text is untrusted: every lookup keyed by it uses hasOwn, and
 * values only reach the project through ProjectState.validateInputs.
 * Browser: window.IntakeMatch; Node: module.exports.
 */
(function (root, factory) {
  const deps = typeof module === "object" && module.exports
    ? [require("./intake-vocab.js"), require("./doc-lines.js"), require("./project-state.js")]
    : [root.IntakeVocab, root.DocLines, root.ProjectState];
  const mod = factory(...deps);
  if (typeof module === "object" && module.exports) module.exports = mod;
  else root.IntakeMatch = mod;
})(typeof self !== "undefined" ? self : this, function (V, DocLines, ProjectState) {
  "use strict";

  const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
  const LEVELS = ["low", "medium", "high"];
  const worse = (a, b) => LEVELS[Math.min(LEVELS.indexOf(a), LEVELS.indexOf(b))];
  const better = (a, b) => LEVELS[Math.max(LEVELS.indexOf(a), LEVELS.indexOf(b))];
  const clip = (s) => { const t = String(s).replace(/\s+/g, " ").trim(); return t.length > 200 ? t.slice(0, 197) + "…" : t; };
  const round = (v) => Math.round(v * 100) / 100;
  const fmt = (v) => (Number.isInteger(v) ? String(v) : String(round(v)));

  // ------------------------------------------------------------ values

  const JUNK = new Set(["", "n a", "na", "nil", "none entered", "undefined", "nan", "null", "not entered", "no value entered", "tbd", "tba"]);
  const isJunk = (raw) => {
    const s = String(raw === null || raw === undefined ? "" : raw).trim();
    return !s || /^[-–—?.\s]+$/.test(s) || JUNK.has(V.norm(s));
  };
  // OCR confuses O/o with 0 and l/I with 1; fix only inside tokens that are mostly digits.
  const fixDigits = (s) => s.replace(/[0-9OolI][0-9OolI.,]*/g, (t) => (/\d/.test(t) && (t.match(/\d/g) || []).length >= t.replace(/[.,]/g, "").length / 2 ? t.replace(/[Oo]/g, "0").replace(/[lI]/g, "1") : t));

  function parseNumberToken(t) {
    const s = String(t).trim().replace(/^[~≈]|^approx\.?\s*/i, "");
    let m;
    if ((m = s.match(/^([+-]?)(\d{1,3}(?:,\d{3})+)(\.\d+)?$/))) return Number(m[1] + m[2].replace(/,/g, "") + (m[3] || ""));
    if ((m = s.match(/^([+-]?)(\d{1,2}(?:,\d{2})+,\d{3})(\.\d+)?$/))) return Number(m[1] + m[2].replace(/,/g, "") + (m[3] || "")); // Indian lakh grouping: 1,00,000
    if ((m = s.match(/^([+-]?)(\d{1,3}(?: \d{3})+)(\.\d+)?$/))) return Number(m[1] + m[2].replace(/ /g, "") + (m[3] || ""));
    if (/^[+-]?\d+(\.\d+)?$/.test(s)) return Number(s);
    return null;
  }

  // Unit words that may sit next to a number; removed before the number is read.
  const UNIT_SURFACE = /(?:sq\.?\s*ft|sq\.?\s*m|sqft|sqm|ft²|ft2|m²|m2|rn2|square\s+(?:feet|meters?|metres?)|°\s*[cf]|deg\.?\s*[cf]|\boc\b|mm\s*w[cg]|in\s*wc|pascals?|\bpa\b|%\s*rh|\brh\b|%|ach\/hr|\bach\b|\/hr|\blux\b|\bppb\b|µs\/cm|us\/cm|cfu\/ml|\bdba\b|\bminutes?\b|\bmins?\b|m\/s|µm|\bum\b|\bmm\b|\bft\b|\bfeet\b|\bm\b|\bc\b|\bf\b|\bnos?\b)/gi;

  function unitIn(raw, family) {
    const n = ` ${V.norm(raw)} `;
    for (const [phrase, factor, label] of (V.UNITS[family] || [])) {
      if (n.includes(` ${phrase} `)) return { factor, label: label || null };
    }
    if (family === "temperature" && /°\s*f|deg\.?\s*f/i.test(raw)) return { factor: V.UNITS.temperature[0][1], label: "°F" };
    return null;
  }
  const applyUnit = (v, unit) => (unit && unit.label ? round(typeof unit.factor === "function" ? unit.factor(v) : v * unit.factor) : v);

  function readNumber(raw, family, hint, ocr) {
    if (isJunk(raw)) return null;
    const fixed = ocr ? fixDigits(String(raw)) : String(raw);
    const rest = fixed.replace(UNIT_SURFACE, " ").replace(/\s+/g, " ").trim();
    const v = parseNumberToken(rest);
    if (v === null || !Number.isFinite(v) || Math.abs(v) > 1e9) return null;
    const unit = (family && unitIn(fixed, family)) || (family && hint && unitIn(hint, family)) || null;
    const out = applyUnit(v, unit);
    return { value: out, converted: unit && unit.label ? `from ${rest} ${unit.label}` : null };
  }

  function readRange(raw, family, hint, ocr) {
    if (isJunk(raw)) return null;
    const s = (ocr ? fixDigits(String(raw)) : String(raw)).replace(/undefined|null/gi, "?").replace(/[–—−]/g, "-");
    const unit = (family && unitIn(s, family)) || (family && hint && unitIn(hint, family)) || null;
    const body = s.replace(UNIT_SURFACE, " ").replace(/\s+/g, " ").trim();
    const N = (t) => (t === "?" ? null : parseNumberToken(t));
    const NUM = "[+-]?\\d[\\d,]*(?:\\.\\d+)?";
    let min = null, max = null, m;
    if ((m = body.match(new RegExp(`^(${NUM})\\s*(?:±|\\+\\/-|\\+-)\\s*(${NUM})$`)))) {
      const a = N(m[1]), d = N(m[2]);
      if (a === null || d === null) return null;
      min = a - d; max = a + d;
    } else if ((m = body.match(new RegExp(`^(?:≤|<=|<|nmt|max\\.?|maximum|up\\s*to|upto|below|not more than)\\s*(${NUM})$`, "i")))) {
      max = N(m[1]); if (max === null) return null;
    } else if ((m = body.match(new RegExp(`^(?:≥|>=|>|nlt|min\\.?|minimum|at least|above|not less than)\\s*(${NUM})$`, "i")))) {
      min = N(m[1]); if (min === null) return null;
    } else if ((m = body.match(new RegExp(`^(\\?|${NUM})\\s*(?:-|to)\\s*(\\?|${NUM})$`, "i")))) {
      min = N(m[1]); max = N(m[2]);
      if ((m[1] !== "?" && min === null) || (m[2] !== "?" && max === null) || (min === null && max === null)) return null;
    } else {
      const a = N(body); if (a === null) return null;
      min = a; max = a;
    }
    if (min !== null) min = applyUnit(min, unit);
    if (max !== null) max = applyUnit(max, unit);
    if ([min, max].some((x) => x !== null && (!Number.isFinite(x) || Math.abs(x) > 1e9))) return null;
    if (min !== null && max !== null && min > max) return null;
    return { value: { min, max }, converted: unit && unit.label ? `from ${body} ${unit.label}` : null };
  }

  const compact = (s) => V.norm(s).replace(/ /g, "");

  function readSelect(param, raw) {
    if (isJunk(raw)) return null;
    const text = String(raw).replace(/^['"‘’“”]+|['"‘’“”]+$/g, "").trim();
    const options = ProjectState.optionsFor(param);
    const exact = options.find((o) => compact(o) === compact(text));
    if (exact) return { value: exact };
    if (param.id === "HVAC-001") {
      const hit = V.GRADES.filter(([phrase]) => V.hasPhrase(text, phrase)).sort((a, b) => b[0].length - a[0].length)[0];
      return hit ? { value: hit[1] } : null;
    }
    const contained = options.filter((o) => compact(o).length >= 2 && V.hasPhrase(text, o)).sort((a, b) => b.length - a.length)[0];
    if (contained) return { value: contained };
    const within = options.filter((o) => compact(text).length >= 4 && compact(o).includes(compact(text)));
    return within.length === 1 ? { value: within[0] } : null;
  }

  function readBoolean(raw) {
    if (isJunk(raw)) return null;
    const n = V.norm(raw);
    const starts = (w) => n === w || n.startsWith(w + " ");
    if (V.BOOLEAN_WORDS.false.some(starts)) return false;
    if (V.BOOLEAN_WORDS.true.some(starts)) return true;
    return null;
  }

  // One cell or phrase -> a value in the shape checkValue accepts, or null.
  // hint: extra text carrying a unit (e.g. the column header "Area (sq ft)").
  // opts.ocr: the text came from OCR, so O/l inside numbers are read as 0/1.
  function parseValue(param, raw, hint, opts = {}) {
    if (!param) return null;
    const family = own(V.UNIT_FAMILY, param.id) ? V.UNIT_FAMILY[param.id] : null;
    switch (ProjectState.resolveInputKind(param)) {
      case "number": return readNumber(raw, family, hint, !!opts.ocr);
      case "number-range": return readRange(raw, family, hint, !!opts.ocr);
      case "select": return readSelect(param, raw);
      case "boolean": { const b = readBoolean(raw); return b === null ? null : { value: b }; }
      case "boolean-text": { const b = readBoolean(raw); return b === null ? null : { value: { value: b } }; }
      case "text": return isJunk(raw) ? null : { value: String(raw).trim().slice(0, ProjectState.LIMITS.textMax) };
      default: return null;
    }
  }

  // How a value reads on the review screen ("120 m²", "18–22 °C", "Yes").
  function unitOf(param) {
    const u = param && param.unit_options;
    return u && u.length <= 12 && !u.includes(" / ") && param.id !== "DFS-003" ? u : "";
  }
  function displayValue(param, v) {
    if (v === null || v === undefined) return "—";
    const unit = unitOf(param);
    const withUnit = (s) => (unit ? `${s} ${unit}` : s);
    switch (ProjectState.resolveInputKind(param)) {
      case "number": return typeof v === "number" ? withUnit(fmt(v)) : String(v);
      case "number-range": {
        const a = v.min === null || v.min === undefined ? null : fmt(v.min);
        const b = v.max === null || v.max === undefined ? null : fmt(v.max);
        return withUnit(a !== null && b !== null ? (a === b ? a : `${a}–${b}`) : a !== null ? `≥ ${a}` : b !== null ? `≤ ${b}` : "—");
      }
      case "boolean": return v === true ? "Yes" : v === false ? "No" : "—";
      case "boolean-text": return v.value === true ? "Yes" : v.value === false ? "No" : "—";
      default: return String(v);
    }
  }

  // ------------------------------------------------------------ names

  function bestMatch(text, phrases, keyOf, stop) {
    const toks = V.tokens(text).filter((t) => !(stop && stop.has(t)));
    if (!toks.length) return null;
    const set = new Set(toks);
    const best = new Map();
    for (const ph of phrases) {
      const inter = ph.toks.filter((t) => set.has(t)).length;
      if (!inter) continue;
      let score;
      if (inter === ph.toks.length && inter === toks.length) score = ph.full ? 1 : 0.95;
      else {
        const dice = (2 * inter) / (ph.toks.length + toks.length);
        const contain = inter === ph.toks.length ? 0.6 + (0.4 * inter) / toks.length : 0;
        score = Math.max(dice, contain) * (ph.full ? 1 : 0.98);
      }
      const k = keyOf(ph);
      if (!best.has(k) || best.get(k) < score) best.set(k, score);
    }
    const ranked = [...best].sort((a, b) => b[1] - a[1]);
    if (!ranked.length) return null;
    const [id, score] = ranked[0];
    const ambiguous = ranked.length > 1 && score - ranked[1][1] < 0.05 && score < 0.99;
    return { id, score, ambiguous };
  }

  const ROOM_STOP = new Set(["room", "area", "the", "and", "of", "for", "or", "zone", "suite"]);
  const FACILITY_WORDS = new Set(["facility", "facility wide", "general", "site", "common", "overall"]);
  function matchRoom(text, ctx) {
    if (FACILITY_WORDS.has(V.norm(text))) return { facility: true, score: 1 };
    const m = bestMatch(text, ctx.rooms, (p) => p.roomId, ROOM_STOP);
    return m && m.score >= 0.6 ? { roomId: m.id, score: m.score, ambiguous: m.ambiguous } : null;
  }
  function matchParam(text, ctx) {
    const m = bestMatch(text, ctx.params, (p) => p.paramId, null);
    return m && m.score >= 0.75 ? { paramId: m.id, score: m.score, ambiguous: m.ambiguous } : null;
  }
  function headerParam(header, ctx) {
    const plain = String(header).replace(/\([^)]*\)/g, " ");
    const hit = V.PARAM_HEADERS.filter(([phrase]) => V.hasPhrase(plain, phrase)).sort((a, b) => b[0].length - a[0].length)[0];
    if (hit) return { paramId: hit[1], score: 1 };
    const m = matchParam(plain, ctx);
    return m && m.score >= 0.85 ? m : null;
  }
  function roleOf(header) {
    const n = V.norm(String(header).replace(/\([^)]*\)/g, " "));
    for (const role of ["room", "param", "value"]) if (V.ROLE_WORDS[role].some((w) => n === w || n.startsWith(w + " "))) return role;
    return null;
  }

  const isRoomLevel = (param) => param.applies_at === "Room";

  // ------------------------------------------------------------ rule extractor

  function level({ room = 1, param = 1, conf = 1, ambiguous = false, cap = "high" }) {
    let l = "high";
    if (room < 0.99 || param < 0.9 || conf < 0.85) l = "medium";
    if (room < 0.75 || param < 0.8 || conf < 0.6 || ambiguous) l = "low";
    return worse(l, cap);
  }

  function paramCandidate(ctx, out, { roomText, room, paramId, raw, hint, page, text, reason, conf = 1, cap = "high", paramScore = 1, paramAmbiguous = false }) {
    if (!own(ctx.DATA.paramById, paramId)) return;
    const param = ctx.DATA.paramById[paramId];
    const r = room || (roomText !== undefined ? matchRoom(roomText, ctx) : { facility: true, score: 1 });
    if (!r) return;
    if (r.facility && isRoomLevel(param)) return; // a room parameter needs a room
    if (!r.facility && !isRoomLevel(param)) return; // facility values aren't per room
    const parsed = parseValue(param, raw, hint, { ocr: ctx.ocr });
    if (!parsed) return;
    const target = r.facility ? { kind: "param", scope: "facility", paramId } : { kind: "param", scope: "room", roomId: r.roomId, paramId };
    out.push({
      target,
      value: parsed.value,
      display: displayValue(param, parsed.value),
      source: { page, text: clip(text) },
      confidence: level({ room: r.score, param: paramScore, conf, ambiguous: r.ambiguous || paramAmbiguous, cap }),
      reason,
      converted: parsed.converted || null,
    });
  }

  function isHeaderLine(line, ctx) {
    if (line.cells.length < 2) return false;
    if (line.cells.some((c) => /\d/.test(c.text.replace(/\([^)]*\)/g, "")))) return false;
    const roles = line.cells.map((c) => roleOf(c.text));
    if (!roles.includes("room")) return false;
    return roles.includes("param") || roles.includes("value") || line.cells.some((c) => roleOf(c.text) !== "room" && headerParam(c.text, ctx));
  }

  function fromTables(page, ctx, out, used) {
    const tables = DocLines.tables(page.lines, (l) => isHeaderLine(l, ctx));
    for (const t of tables) {
      t.lineIndexes.forEach((i) => used.add(i));
      const roles = t.header.map(roleOf);
      const roomCol = roles.indexOf("room");
      const paramCol = roles.indexOf("param");
      const valueCol = roles.indexOf("value");
      // The table's weakest OCR confidence (1 for a PDF text layer).
      const conf = Math.min(1, ...t.lineIndexes.map((i) => page.lines[i]).filter(Boolean).flatMap((l) => l.cells.map((c) => c.conf)));
      if (paramCol >= 0 && valueCol >= 0) {
        for (const row of t.rows) {
          const p = matchParam(row[paramCol], ctx);
          if (!p) continue;
          paramCandidate(ctx, out, {
            roomText: row[roomCol], paramId: p.paramId, raw: row[valueCol], page: page.index,
            text: row.filter(Boolean).slice(0, 4).join(" | "), reason: `table row (${t.header[paramCol]} / ${t.header[valueCol]})`,
            conf, paramScore: p.score, paramAmbiguous: p.ambiguous,
          });
        }
      } else {
        const cols = t.header.map((h, k) => (k === roomCol ? null : headerParam(h, ctx)));
        for (const row of t.rows) {
          const room = matchRoom(row[roomCol], ctx);
          if (!room) continue;
          cols.forEach((c, k) => {
            if (!c || !row[k]) return;
            paramCandidate(ctx, out, {
              room, paramId: c.paramId, raw: row[k], hint: t.header[k], page: page.index,
              text: `${row[roomCol]} | ${t.header[k]}: ${row[k]}`, reason: `table column “${t.header[k]}”`, conf, paramScore: c.score,
            });
          });
        }
      }
    }
  }

  const KV_ROOM = /^(.{3,80}?)\s*\((.+)\)\s*:\s*(.+)$/;
  const KV_FACILITY = /^([^:()]{3,60}):\s*(.{1,60})$/;
  const SENTENCE = /\b(?:Increase|Decrease|Reduce|Adjust|Upgrade|Change|Set|Raise|Lower)\s+(.+?)\s+in\s+['‘](.+?)['’]\s+from\s+(.+?)\s+to\b/g;
  const SHORT_VALUE = /(\d[\d.,]*\s*(?:m²|m2|sq\.?\s*m|sqm|sq\.?\s*ft|°\s*c|%\s*rh|pa\b|ach\b|lux\b))|((?:grade|iso(?:\s+class)?)\s+[a-d5-8]\b)/gi;

  // Room names carry words and grades of their own ("Gowning — Stage 2 (Grade
  // D→Grade C)", "(Vials/Ampoules/PFS/Cartridge)"); blank them out wherever
  // free text is searched for values or facility-level words.
  // Wrapped names leave fragments, so each name's bracketed part goes too, as
  // does grade-transition notation ("Grade D→Grade C", "General→Grade D").
  function withoutRoomNames(text, DATA) {
    let t = String(text);
    for (const r of DATA.rooms || []) {
      for (const piece of [r.name, ...(r.name.match(/\([^()]{3,}\)/g) || [])]) if (t.includes(piece)) t = t.split(piece).join(" ");
    }
    return t.replace(/(?:grade\s+[a-d]|general)\s*→\s*(?:grade(?:\s+[a-d])?)?/gi, " ");
  }

  function fromFreeText(page, ctx, out, used) {
    const free = page.lines.filter((l, i) => !used.has(i));
    const sentenceSpans = [];
    // Recommendation sentences: "Increase <param> in '<room>' from <value> to …".
    const joined = free.filter((l) => !l.label).map((l) => l.text).join(" ");
    for (const m of joined.matchAll(SENTENCE)) {
      sentenceSpans.push(m[0]);
      const p = matchParam(m[1], ctx);
      if (!p) continue;
      paramCandidate(ctx, out, {
        roomText: m[2], paramId: p.paramId, raw: m[3].replace(/^['‘]|['’]$/g, ""), page: page.index,
        text: m[0], reason: "sentence “… in ‘room’ from value …”", cap: "medium", paramScore: p.score, paramAmbiguous: p.ambiguous,
      });
    }
    for (let li = 0; li < free.length; li++) {
      const line = free[li];
      let text = line.text;
      let m;
      // "Param (Room):" with the value on the next line.
      const nextLine = free[li + 1];
      if (!line.label && /:\s*$/.test(text) && nextLine && !nextLine.label && V.tokens(nextLine.text).length <= 6 && !/:\s*$/.test(nextLine.text)) {
        text = `${text} ${nextLine.text}`;
      }
      if (!line.label && /\)\s*:\s*$/.test(text)) continue; // "Param (Room):" with no value at all
      if (!line.label && (m = text.match(KV_ROOM))) {
        const p = matchParam(m[1], ctx);
        if (p) {
          paramCandidate(ctx, out, { roomText: m[2], paramId: p.paramId, raw: m[3], page: page.index, text, reason: "line “parameter (room): value”", paramScore: p.score, paramAmbiguous: p.ambiguous });
          continue;
        }
      }
      if (!line.label && (m = text.match(KV_FACILITY))) {
        const p = matchParam(m[1], ctx);
        if (p && p.score >= 0.9 && !isRoomLevel(ctx.DATA.paramById[p.paramId])) {
          paramCandidate(ctx, out, { paramId: p.paramId, raw: m[2], page: page.index, text, reason: "line “parameter: value”", paramScore: p.score });
          continue;
        }
      }
      // Short lines and drawing labels: "<room name> 120 m² Grade C".
      if (V.tokens(text).length > 12 || sentenceSpans.some((sp) => sp.includes(text))) continue;
      const values = [...withoutRoomNames(text, ctx.DATA).matchAll(SHORT_VALUE)].map((x) => x[0]);
      if (!values.length) continue;
      let roomText = text;
      values.forEach((v) => { roomText = roomText.replace(v, " "); });
      const room = matchRoom(roomText, ctx);
      if (!room || room.facility || room.score < 0.75) continue;
      for (const v of values) {
        const n = ` ${V.norm(v)} `;
        const hit = V.UNIT_PARAM.find(([u]) => n.includes(` ${V.norm(u)} `));
        const paramId = /grade|iso/i.test(v) ? "HVAC-001" : hit ? hit[1] : null;
        if (!paramId) continue;
        paramCandidate(ctx, out, { room, paramId, raw: v, page: page.index, text, reason: line.label ? "drawing label" : "short line with a room name", cap: line.label ? "low" : "medium" });
      }
    }
  }

  // Text for facility-level words: table cells and quoted names (room names in
  // recommendation sentences) are left out so "Sterile Dry Powder Filling"
  // doesn't count as the document saying "sterile".
  function prose(pages, usedByPage, DATA) {
    return pages.map((p) => ({
      page: p.index,
      lines: p.lines.filter((l, i) => !(usedByPage.get(p.index) || new Set()).has(i))
        .map((l) => withoutRoomNames(l.text.replace(/['‘][^'’]{2,120}['’]/g, " "), DATA)),
    }));
  }
  const firstLine = (texts, phrase) => {
    for (const t of texts) for (const line of t.lines) if (V.hasPhrase(line, phrase)) return { page: t.page, text: line };
    return null;
  };

  function facilityLevel(pages, ctx, out, usedByPage) {
    const texts = prose(pages, usedByPage, ctx.DATA);
    const allTexts = pages.map((p) => ({ page: p.index, lines: p.lines.map((l) => l.text) }));
    const DATA = ctx.DATA;
    const label = (key) => (ProjectState.CATEGORY_DEFS.find((c) => c.key === key) || {}).label || key;
    // Markets: the dataset's own labels and the extra names.
    for (const a of DATA.authorities || []) {
      const phrases = [a.label].concat(own(V.MARKET_WORDS, a.key) ? V.MARKET_WORDS[a.key] : []);
      let hit = null;
      for (const ph of phrases) { hit = firstLine(allTexts, ph); if (hit) break; }
      if (!hit) continue;
      if (a.covered === false) {
        out.push({ target: { kind: "note" }, value: a.key, display: `${a.label} is mentioned but not covered by this dataset, so it can't be checked.`, source: { page: hit.page, text: clip(hit.text) }, confidence: "low", reason: "authority name", converted: null });
      } else {
        out.push({ target: { kind: "market" }, value: a.key, display: a.label, source: { page: hit.page, text: clip(hit.text) }, confidence: "medium", reason: "authority named in the document", converted: null });
      }
    }
    // Category: words the document states (the one with the most distinct words)…
    const scores = Object.entries(V.CATEGORY_WORDS).map(([key, words]) => {
      const hits = words.map((w) => firstLine(texts, w)).filter(Boolean);
      return { key, n: hits.length, hit: hits[0] };
    }).filter((s) => s.n).sort((a, b) => b.n - a.n);
    let category = null;
    if (scores.length && (scores.length === 1 || scores[0].n > scores[1].n)) {
      category = scores[0].key;
      out.push({ target: { kind: "category" }, value: category, display: label(category), source: { page: scores[0].hit.page, text: clip(scores[0].hit.text) }, confidence: scores[0].n >= 2 ? "high" : "medium", reason: "category named in the document", converted: null });
    }
    // …or, failing that, the rooms found: rooms that exist in only one category decide it.
    if (!category) {
      const rooms = [...new Set(out.filter((c) => c.target.roomId).map((c) => c.target.roomId))].map((id) => DATA.roomById[id]).filter(Boolean);
      const only = {};
      for (const r of rooms) {
        const cats = Object.keys(r.applies_to || {}).filter((k) => r.applies_to[k]);
        if (cats.length === 1) only[cats[0]] = (only[cats[0]] || 0) + 1;
      }
      const keys = Object.keys(only);
      if (keys.length === 1) {
        category = keys[0];
        const src = out.find((c) => c.target.roomId && (DATA.roomById[c.target.roomId].applies_to || {})[category]
          && Object.values(DATA.roomById[c.target.roomId].applies_to).filter(Boolean).length === 1);
        const n = only[category];
        out.push({ target: { kind: "category" }, value: category, display: label(category), source: src ? src.source : { page: 1, text: "" }, confidence: "medium", reason: `inferred from ${n} room${n === 1 ? "" : "s"} used only in ${label(category)} facilities`, converted: null });
      }
    }
    // Specific forms: full names or short forms; one-word names only within the category found.
    const forms = category ? ProjectState.SPECIFIC_FORMS[category] : null;
    const seen = new Set();
    for (const [phrase, form] of V.formPhrases(ProjectState.SPECIFIC_FORMS)) {
      if (seen.has(form)) continue;
      if (forms ? !forms.includes(form) : V.tokens(phrase).length < 2) continue;
      const hit = firstLine(texts, phrase);
      if (!hit) continue;
      seen.add(form);
      out.push({ target: { kind: "form" }, value: form, display: form, source: { page: hit.page, text: clip(hit.text) }, confidence: phrase === form ? "high" : "medium", reason: "dosage form named in the document", converted: null });
    }
    for (const [phrase, stage] of Object.entries(V.DEV_STAGE_WORDS)) {
      const hit = firstLine(texts, phrase);
      if (hit) { out.push({ target: { kind: "devStage" }, value: stage, display: stage, source: { page: hit.page, text: clip(hit.text) }, confidence: "medium", reason: "development stage named in the document", converted: null }); break; }
    }
  }

  function addRooms(ctx, out) {
    const best = new Map();
    for (const c of out) {
      if (c.target.kind !== "param" || c.target.scope !== "room") continue;
      const prev = best.get(c.target.roomId);
      if (!prev || LEVELS.indexOf(c.confidence) > LEVELS.indexOf(prev.confidence)) best.set(c.target.roomId, c);
    }
    for (const [roomId, c] of best) {
      out.push({ target: { kind: "room", roomId }, value: roomId, display: ctx.DATA.roomById[roomId].name, source: c.source, confidence: c.confidence, reason: "room named in the document", converted: null });
    }
  }

  const ruleExtractor = {
    id: "rules",
    label: "Built-in rules",
    run(doc, { DATA }) {
      const ctx = { DATA, rooms: V.roomPhrases(DATA), params: V.paramPhrases(DATA) };
      const out = [];
      const usedByPage = new Map();
      const pages = (doc && Array.isArray(doc.pages) ? doc.pages : []).filter((p) => p && Array.isArray(p.lines));
      for (const page of pages) {
        const used = new Set();
        usedByPage.set(page.index, used);
        ctx.ocr = page.source === "ocr";
        fromTables(page, ctx, out, used);
        fromFreeText(page, ctx, out, used);
      }
      addRooms(ctx, out);
      facilityLevel(pages, ctx, out, usedByPage);
      return out;
    },
  };

  // The AI slot: later extractors are added here and run the same way.
  const extractors = [ruleExtractor];
  const runAll = (doc, ctx) => extractors.flatMap((e) => e.run(doc, ctx));

  // ------------------------------------------------------------ resolve

  function keyOf(t) {
    switch (t.kind) {
      case "param": return t.scope === "facility" ? `param:facility:${t.paramId}` : `param:room:${t.roomId}:${t.paramId}`;
      case "room": return `room:${t.roomId}`;
      case "category": case "devStage": return t.kind;
      default: return null; // market/form/note are keyed with their value
    }
  }
  const candKey = (c, i) => keyOf(c.target) || (c.target.kind === "note" ? `note:${i}` : `${c.target.kind}:${c.value}`);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function currentOf(state, t) {
    switch (t.kind) {
      case "category": return state.category || null;
      case "devStage": return state.devStage || null;
      case "param": {
        const map = t.scope === "facility" ? state.facilityValues : own(state.roomValues, t.roomId) ? state.roomValues[t.roomId] : null;
        const v = map && own(map, t.paramId) ? map[t.paramId] : undefined;
        if (v === undefined || v === null || v === "") return null;
        if (typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => x === null || x === undefined || x === "")) return null;
        return v;
      }
      default: return null; // forms, markets and rooms are added, never replaced
    }
  }
  function isSame(state, t, value) {
    if (t.kind === "form") return (state.specificForms || []).includes(value);
    if (t.kind === "market") return (state.targetMarkets || []).includes(value);
    if (t.kind === "room") return (state.selectedRooms || []).includes(value);
    const cur = currentOf(state, t);
    return cur !== null && same(cur, value);
  }

  // Group candidates per target: agreeing values merge (all sources kept);
  // different values become a conflict the planner must choose (no default).
  // Values matching the project are marked `same`; ones that would overwrite
  // a different entered value carry `replaces`. Only high-confidence,
  // conflict-free, new values start ticked.
  function resolve(candidates, state, DATA) {
    const groups = new Map();
    (candidates || []).forEach((c, i) => {
      const k = candKey(c, i);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    });
    const items = [];
    for (const [key, group] of groups) {
      const target = group[0].target;
      if (target.kind === "note") { items.push({ key, target, note: true, display: group[0].display, sources: [group[0].source], confidence: "low", checked: false }); continue; }
      const byValue = new Map();
      for (const c of group) {
        const vk = JSON.stringify(c.value);
        if (!byValue.has(vk)) byValue.set(vk, { value: c.value, display: c.display, confidence: c.confidence, reason: c.reason, converted: c.converted, sources: [] });
        const o = byValue.get(vk);
        o.confidence = better(o.confidence, c.confidence);
        if (!o.sources.some((s) => s.page === c.source.page && s.text === c.source.text)) o.sources.push(c.source);
      }
      const options = [...byValue.values()];
      const cur = currentOf(state, target);
      const param = target.kind === "param" ? DATA.paramById[target.paramId] : null;
      const curDisplay = cur === null ? null
        : target.kind === "category" ? ((ProjectState.CATEGORY_DEFS.find((c) => c.key === cur) || {}).label || cur)
        : param ? displayValue(param, cur) : String(cur);
      if (options.length === 1) {
        const o = options[0];
        const sameValue = isSame(state, target, o.value);
        const replaces = !sameValue && cur !== null ? curDisplay : null;
        items.push({ key, target, value: o.value, display: o.display, confidence: o.confidence, reason: o.reason, converted: o.converted, sources: o.sources, conflict: false, same: sameValue, replaces, checked: !sameValue && o.confidence === "high" });
      } else {
        items.push({ key, target, options, confidence: options.reduce((a, o) => worse(a, o.confidence), "high"), sources: options.flatMap((o) => o.sources), conflict: true, same: false, replaces: cur !== null ? curDisplay : null, checked: false });
      }
    }
    // Facility first (category, stage, forms, markets, facility values), then rooms in dataset order.
    const roomOrder = new Map((DATA.rooms || []).map((r, i) => [r.id, i]));
    const rank = (it) => {
      const t = it.target;
      const base = { note: 0, category: 1, devStage: 2, form: 3, market: 4 }[t.kind];
      if (base !== undefined) return [base, 0, 0];
      if (t.kind === "param" && t.scope === "facility") return [5, 0, 0];
      return [6, roomOrder.has(t.roomId) ? roomOrder.get(t.roomId) : 9999, t.kind === "room" ? 0 : 1];
    };
    return items.sort((a, b) => { const x = rank(a), y = rank(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
  }

  // ------------------------------------------------------------ apply

  // accepted: [{ target, value, key? }] (resolved items, with a chosen value for conflicts).
  // Returns validateInputs' result plus what was applied and what was left out
  // (e.g. rooms or forms the category doesn't use), and the category memory to
  // keep. Neither the state nor the memory passed in is changed.
  function buildInputs(state, accepted, DATA, memory = {}) {
    const next = JSON.parse(JSON.stringify(ProjectState.serializeInputs(state)));
    const mem = JSON.parse(JSON.stringify(memory || {}));
    const errors = [];
    const applied = [];
    const skipped = [];
    const done = (a, ok) => (ok ? applied : skipped).push(a.key || candKey(a, 0));
    const list = (Array.isArray(accepted) ? accepted : []).filter((a) => a && a.target && a.target.kind !== "note");
    const of = (kind) => list.filter((a) => a.target.kind === kind);
    const cat = of("category")[0];
    if (cat) {
      if (typeof cat.value === "string" && own(ProjectState.SPECIFIC_FORMS, cat.value)) { ProjectState.switchCategory(next, cat.value, mem); done(cat, true); }
      else errors.push(`category: unknown "${String(cat.value).slice(0, 40)}"`);
    }
    const stage = of("devStage")[0];
    if (stage) { next.devStage = stage.value; done(stage, true); }
    for (const f of of("form")) {
      const allowed = next.category ? ProjectState.SPECIFIC_FORMS[next.category] : [];
      const ok = allowed.includes(f.value);
      if (ok && !next.specificForms.includes(f.value)) next.specificForms.push(f.value);
      done(f, ok);
    }
    for (const m of of("market")) {
      const a = own(DATA.authorityByKey, m.value) ? DATA.authorityByKey[m.value] : null;
      const ok = !!a && a.covered !== false;
      if (ok && !next.targetMarkets.includes(m.value)) next.targetMarkets.push(m.value);
      done(m, ok);
    }
    ProjectState.ensurePrimary(next);
    const selectRoom = (id) => {
      const room = DATA.roomById[id];
      if (next.category && !(room.applies_to || {})[next.category]) return false;
      if (!next.selectedRooms.includes(id)) next.selectedRooms.push(id);
      return true;
    };
    for (const r of of("room")) {
      if (own(DATA.roomById, r.value)) done(r, selectRoom(r.value));
      else errors.push(`room: unknown "${String(r.value).slice(0, 40)}"`);
    }
    for (const p of of("param")) {
      const t = p.target;
      if (!own(DATA.paramById, t.paramId)) { errors.push(`unknown parameter "${String(t.paramId).slice(0, 40)}"`); continue; }
      if (t.scope === "facility") { next.facilityValues[t.paramId] = p.value; done(p, true); continue; }
      if (!own(DATA.roomById, t.roomId)) { errors.push(`unknown room "${String(t.roomId).slice(0, 40)}"`); continue; }
      if (!selectRoom(t.roomId)) { done(p, false); continue; } // room not used in this category
      if (!own(next.roomValues, t.roomId)) next.roomValues[t.roomId] = {};
      next.roomValues[t.roomId][t.paramId] = p.value;
      done(p, true);
    }
    if (errors.length) return { ok: false, errors };
    const r = ProjectState.validateInputs(next, DATA);
    return r.ok ? { ...r, applied, skipped, memory: mem } : r;
  }

  return { extractors, runAll, resolve, buildInputs, parseValue, displayValue };
});
