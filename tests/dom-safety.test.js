// T3 / R7 / R8: user-controlled text (project names, notes, entered values)
// must only ever reach the page as text nodes. The app builds DOM through h();
// h() must have no path to innerHTML, and no browser script may use an
// HTML-parsing sink.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
// Load order matches index.html (minus the vendored client and config.js:
// without them the app runs wizard-only, which is what this harness renders).
const BROWSER_SCRIPTS = ["engine.js", "project-state.js", "results-snapshot.js", "store.js", "router.js", "auth.js", "app.js"];

test("browser scripts contain no HTML-parsing sinks (R8)", () => {
  const sinks = /\b(innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment|srcdoc)\b|\beval\s*\(|\bnew Function\s*\(/;
  for (const f of BROWSER_SCRIPTS) {
    fs.readFileSync(path.join(ROOT, f), "utf8").split("\n").forEach((line, i) => {
      assert.doesNotMatch(line, sinks, `${f}:${i + 1}: ${line.trim()}`);
    });
  }
});

// Minimal DOM: enough for app.js to load and h() to build elements. Any
// attempt to parse HTML throws, so a regression fails loudly.
function loadApp() {
  class Node_ { constructor() { this.children = []; } appendChild(c) { this.children.push(c); return c; } }
  class Text_ extends Node_ { constructor(t) { super(); this.nodeType = 3; this.data = String(t); } }
  class El extends Node_ {
    constructor(tag) { super(); this.nodeType = 1; this.tagName = tag; this.attrs = {}; this.className = ""; this.classList = { toggle() {} }; }
    setAttribute(k, v) { this.attrs[k] = String(v); }
    addEventListener() {}
    removeChild(c) { this.children = this.children.filter((x) => x !== c); }
    get firstChild() { return this.children[0]; }
    set innerHTML(_) { throw new Error("innerHTML used"); }
    set outerHTML(_) { throw new Error("outerHTML used"); }
    insertAdjacentHTML() { throw new Error("insertAdjacentHTML used"); }
  }
  const els = {};
  const document = {
    createElement: (t) => new El(t),
    createTextNode: (t) => new Text_(t),
    getElementById: (id) => (els[id] = els[id] || new El("div")),
    querySelectorAll: () => [],
  };
  const fetch = async (url) => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(ROOT, url), "utf8")) });
  const window = { scrollTo() {}, addEventListener() {}, location: { hash: "", href: "http://127.0.0.1:8000/" }, history: { replaceState() {} } };
  const ctx = { document, fetch, window, alert() {}, console, setTimeout };
  ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of BROWSER_SCRIPTS) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), ctx, { filename: f });
  return vm.runInContext("({ h })", ctx);
}

const XSS = '<img src=x onerror="alert(1)">';

test("h() renders markup-looking strings as a single text node (R7)", () => {
  const { h } = loadApp();
  const el = h("td", { class: "name" }, XSS);
  assert.equal(el.children.length, 1);
  assert.equal(el.children[0].nodeType, 3);
  assert.equal(el.children[0].data, XSS);
  const list = h("div", {}, [XSS, 42]);
  assert.deepEqual(list.children.map((c) => [c.nodeType, c.data]), [[3, XSS], [3, "42"]]);
});

test("h() has no html attribute: passing one is an error, not markup", () => {
  const { h } = loadApp();
  assert.throws(() => h("div", { html: XSS }), /html/);
});

test("h() refuses event-handler attributes given as strings", () => {
  const { h } = loadApp();
  assert.throws(() => h("img", { onerror: "alert(1)" }), /onerror/);
});
