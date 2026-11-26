/* PDF intake — layout. Rebuilds reading order and tables from positioned text
 * items, whether they came from a PDF's text layer (pdf.js) or from OCR words
 * (Tesseract). Pure: no DOM, no knowledge of the dataset; deciding what a
 * header means is intake-match.js's job.
 *
 *   toLines(items)          -> [{ y, h, text, cells:[{ text, x0, x1, conf, items }], label }]
 *   tables(lines, isHeader) -> [{ header:[text], rows:[[text]], lineIndexes:[i] }]
 *
 * item = { str, x, y, w, h, rot, conf }: x/y = top-left in page units (y grows
 * downward), rot in radians, conf 0–1 (1 for a PDF text layer).
 * Browser: window.DocLines; Node: module.exports.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) module.exports = mod;
  else root.DocLines = mod;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const ROTATED = (5 * Math.PI) / 180; // drawing labels are often vertical
  const median = (xs, fallback) => {
    const v = xs.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : fallback;
  };
  const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

  function clean(items) {
    return (Array.isArray(items) ? items : [])
      .filter((i) => i && typeof i.str === "string" && i.str.trim())
      .map((i) => ({ str: i.str.replace(/\s+/g, " ").trim(), x: num(i.x), y: num(i.y), w: Math.max(0, num(i.w)), h: Math.max(0, num(i.h, 10)), rot: num(i.rot), conf: Math.min(1, Math.max(0, num(i.conf, 1))) }));
  }

  // Joining wrapped text: "de-" + "boxing room" -> "de-boxing room".
  const joinText = (a, b) => (!a ? b : /-$/.test(a) && /^[a-z]/.test(b) ? a + b : `${a} ${b}`);

  function toCells(items, charW) {
    const cells = [];
    for (const i of items.slice().sort((a, b) => a.x - b.x)) {
      const last = cells[cells.length - 1];
      const piece = { text: i.str, x0: i.x, x1: i.x + i.w, conf: i.conf };
      if (last && i.x - last.x1 <= 1.5 * charW) {
        last.text = `${last.text} ${i.str}`;
        last.x1 = Math.max(last.x1, i.x + i.w);
        last.conf = Math.min(last.conf, i.conf);
        last.items.push(piece);
      } else {
        cells.push({ ...piece, items: [piece] });
      }
    }
    return cells;
  }

  function toLines(rawItems) {
    const items = clean(rawItems);
    if (!items.length) return [];
    const h = median(items.map((i) => i.h), 10);
    const charW = median(items.map((i) => i.w / Math.max(1, i.str.length)), 5);
    const lines = [];
    // Rotated items never join a row; each is its own "label" line.
    for (const i of items.filter((x) => Math.abs(x.rot) > ROTATED)) {
      const piece = { text: i.str, x0: i.x, x1: i.x + i.w, conf: i.conf };
      lines.push({ y: i.y, h: i.h, text: i.str, cells: [{ ...piece, items: [piece] }], label: true });
    }
    const flat = items.filter((x) => Math.abs(x.rot) <= ROTATED).sort((a, b) => a.y - b.y || a.x - b.x);
    const groups = [];
    for (const i of flat) {
      const g = groups[groups.length - 1];
      if (g && Math.abs(i.y - g.y) <= 0.5 * h) g.items.push(i);
      else groups.push({ y: i.y, items: [i] });
    }
    for (const g of groups) {
      const cells = toCells(g.items, charW);
      lines.push({ y: g.y, h: Math.max(...g.items.map((i) => i.h)), text: cells.map((c) => c.text).join(" "), cells, label: false });
    }
    return lines.sort((a, b) => a.y - b.y || (a.cells[0].x0 - b.cells[0].x0));
  }

  // Tables start at a header line (decided by the caller) and take the lines
  // below it until one starts left of the first column, spans two or more
  // columns, is another header, or follows a large gap. Within a table a new
  // record starts after a gap wider than a wrapped line, or on a line that
  // fills most columns at once (dense tables without row padding).
  function tables(lines, isHeader) {
    const out = [];
    const list = Array.isArray(lines) ? lines : [];
    const h = median(list.map((l) => l.h), 10);
    const TOL = 6;
    // Header lines carry no numbers outside brackets ("Area (m²)" is fine).
    const headerish = (l) => !l.label && !l.cells.some((c) => /\d/.test(c.text.replace(/\([^)]*\)/g, "")));
    for (let i = 0; i < list.length; i++) {
      const head = list[i];
      if (head.label || head.cells.length < 2 || !isHeader(head)) continue;
      // A wrapped or vertically centred header ("Area" / "(m²)") spans several
      // lines just above and below: merge that block, column by column.
      let top = i;
      let bottom = i;
      while (top > 0 && headerish(list[top - 1]) && list[top].y - list[top - 1].y <= 1.3 * h) top--;
      while (bottom + 1 < list.length && headerish(list[bottom + 1]) && !isHeader(list[bottom + 1]) && list[bottom + 1].y - list[bottom].y <= 1.3 * h) bottom++;
      const clusters = [];
      for (let k = top; k <= bottom; k++) {
        for (const piece of list[k].cells.flatMap((c) => c.items || [c]).sort((x, y) => x.x0 - y.x0)) {
          const c = clusters.find((cl) => Math.abs(cl.x0 - piece.x0) <= TOL || (piece.x0 < cl.x1 - TOL && piece.x1 > cl.x0 + TOL));
          if (c) { c.texts.push(piece.text); c.x0 = Math.min(c.x0, piece.x0); c.x1 = Math.max(c.x1, piece.x1); }
          else clusters.push({ x0: piece.x0, x1: piece.x1, texts: [piece.text] });
        }
      }
      clusters.sort((x, y) => x.x0 - y.x0);
      const cols = clusters.map((c) => c.x0);
      const headerTexts = clusters.map((c) => c.texts.join(" "));
      const colOf = (x) => { let k = 0; cols.forEach((c, j) => { if (c <= x + TOL) k = j; }); return k; };
      const spans = (c) => cols.filter((x) => x > c.x0 + TOL && x < c.x1 - TOL).length >= 2;
      const rows = [];
      const used = [];
      for (let k = top; k <= bottom; k++) used.push(k);
      let prevY = list[bottom].y;
      let j = bottom + 1;
      for (; j < list.length; j++) {
        const l = list[j];
        if (l.label || isHeader(l)) break;
        // Place the original items, not merged cells: tight tables can put a
        // short cell right against the next column's text.
        const pieces = l.cells.flatMap((c) => c.items || [c]);
        if (pieces.some((c) => c.x0 < cols[0] - TOL || spans(c))) break;
        const gap = l.y - prevY;
        if (gap > 15 * h) break; // printed reports pad wrapped rows generously (gaps up to ~100pt seen)
        const filled = new Set(pieces.map((c) => colOf(c.x0)));
        const startsRow = !rows.length || gap > 1.8 * h || (gap > 1.2 * h && filled.size >= 3 && filled.size / cols.length > 0.6);
        if (startsRow) rows.push(cols.map(() => ""));
        const row = rows[rows.length - 1];
        for (const c of pieces) { const k = colOf(c.x0); row[k] = joinText(row[k], c.text); }
        used.push(j);
        prevY = l.y;
      }
      const real = rows.filter((r) => r.filter(Boolean).length >= 2);
      if (real.length) out.push({ header: headerTexts, rows: real, lineIndexes: used });
      i = j - 1;
    }
    return out;
  }

  return { toLines, tables };
});
