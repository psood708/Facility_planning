// Results redesign, Phase 3: colour contrast and forced-colours rules,
// read straight from results.css so a palette change can't regress them.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const CSS = fs.readFileSync(path.join(__dirname, "..", "results.css"), "utf8");
const varOf = (name) => {
  const m = CSS.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(m, `--${name} is defined in results.css`);
  return m[1];
};
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test("chart marks reach 3:1 against the page (WCAG 1.4.11), amber included", () => {
  for (const name of ["fill-critical", "fill-significant", "fill-partial", "fill-compliant", "fill-noncompliant", "band-edge"]) {
    const c = contrast(varOf(name), "#ffffff");
    assert.ok(c >= 3, `--${name} ${varOf(name)} is ${c.toFixed(2)}:1`);
  }
});

test("the severity rail is a border, so it survives forced colours", () => {
  for (const k of ["critical", "significant", "partial"]) assert.match(CSS, new RegExp(`\\.fix-sev-${k}\\s*\\{[^}]*border-left-color`));
  assert.doesNotMatch(CSS, /\.fix-sev-[a-z]+\s*\{[^}]*box-shadow/);
});

test("forced colours keep every encoding that colour alone would lose", () => {
  const block = (CSS.match(/@media \(forced-colors: active\) \{([\s\S]*?)\n\}/g) || []).join("\n");
  for (const sel of [".cell-fail", ".mx-cell", ".unlock-on", ".band-edge", ".miss", ".verdict-glyph"]) assert.ok(block.includes(sel), `${sel} in a forced-colors rule`);
});
