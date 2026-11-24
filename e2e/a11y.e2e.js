// Browser accessibility pass: runs axe-core (WCAG 2.0/2.1/2.2 A + AA) and a
// reflow check on every screen, at phone and desktop widths, against the real
// app and local Supabase. Same prerequisites as signin.e2e.js.
// axe is evaluated through DevTools (page.evaluate), which the page's CSP does
// not govern, so the app keeps its strict script-src 'self'. It never ships:
// scripts/build.js only copies what index.html loads.
// Run: npm run test:e2e
const fs = require("node:fs");
const { APP, launch, check, signIn, collectErrors, uniqueEmail } = require("./lib.js");
const { admin } = require("../db-tests/helpers.js");

const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const VIEWPORTS = [{ width: 390, height: 844 }, { width: 1440, height: 900 }];

async function audit(page, scene) {
  await page.evaluate(AXE);
  const violations = await page.evaluate(async (tags) => {
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, count: v.nodes.length, first: v.nodes[0] && v.nodes[0].target.join(" ") }));
  }, TAGS);
  const width = page.viewportSize().width;
  check(`${scene} @${width}: no axe violations`, violations.length === 0,
    violations.map((v) => `${v.id} (${v.impact}, ${v.count}× e.g. ${v.first})`).join("; "));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${scene} @${width}: no horizontal page scroll`, overflow <= 0, `overflows by ${overflow}px`);
}

// The wizard UI predates accounts; fill its state directly (as projects.e2e.js does).
const FILL = () => {
  Object.assign(state, {
    category: "sterile", specificForms: ["Sterile Liquid (Vial)"], targetMarkets: ["schedule_m", "us_fda", "eu_gmp", "who_gmp"],
    selectedRooms: ["Z-29", "Z-01"], facilityValues: { "UTIL-001": "Class 2" },
    roomValues: { "Z-29": { "DIM-001": 120, "HVAC-001": "Grade B", "HVAC-002": { min: 19, max: 24 } } },
  });
};

async function scenes(page, viewport, projectId) {
  await page.setViewportSize(viewport);

  await page.goto("about:blank");
  await page.goto(APP + "#/projects");
  await page.waitForSelector("#view-projects .project-list, #view-projects .empty-state");
  await audit(page, projectId ? "projects list" : "projects (empty)");

  await page.click("text=New project");
  await page.waitForSelector("#step-1:not([hidden])");
  await page.click("#btn-next");
  await page.waitForSelector("#step-1 [role=alert]");
  await audit(page, "step 1 with validation errors");

  await page.evaluate(FILL);
  for (const n of [2, 3]) {
    await page.evaluate((step) => showStep(step), n);
    await page.waitForSelector(`#step-${n}:not([hidden])`);
    await audit(page, `step ${n}`);
  }
  await page.evaluate(() => showStep(4));
  await page.waitForSelector("#step-4:not([hidden]) h2");
  await audit(page, "step 4 results (live)");
  await page.evaluate(() => document.querySelectorAll("#step-4 details").forEach((d) => (d.open = true)));
  await audit(page, "step 4 results with all details open");

  if (projectId) {
    // Discard the throwaway wizard state so leaving doesn't trigger the unsaved prompt.
    await page.evaluate(() => { if (CURRENT) CURRENT.savedFingerprint = currentFingerprint(); });
    await page.goto("about:blank");
    await page.goto(APP + "#/projects/" + projectId);
    await page.waitForSelector(".stale-banner");
    await audit(page, "saved project, stale results (read-only)");
  }
}

(async () => {
  const browser = await launch();
  const page = await (await browser.newContext()).newPage();
  const errors = collectErrors(page);

  await page.goto(APP + "#/signin");
  await page.waitForSelector("#view-signin:not([hidden]) form");
  for (const v of VIEWPORTS) { await page.setViewportSize(v); await audit(page, "sign-in"); }
  await page.setViewportSize({ width: 320, height: 700 });
  await audit(page, "sign-in");

  await signIn(page, uniqueEmail("a11y"));
  await scenes(page, VIEWPORTS[0], null);

  // Keyboard: arrowing through the category radios must not lose work (WCAG 3.2.2).
  await page.evaluate(() => { if (CURRENT) CURRENT.savedFingerprint = currentFingerprint(); });
  await page.goto("about:blank");
  await page.goto(APP + "#/projects/new");
  await page.waitForSelector('input[name="category"][value="sterile"]');
  await page.check('input[name="category"][value="sterile"]');
  await page.locator('#step-1 [data-field="specificForms"] input[type=checkbox], #step-1 fieldset input[type=checkbox]').first().check();
  const chosen = await page.evaluate(() => [...state.specificForms]);
  await page.focus('input[name="category"][value="sterile"]');
  await page.keyboard.press("ArrowLeft");
  await page.waitForFunction(() => state.category === "osd_rnd_pilot");
  await page.focus('input[name="category"]:checked');
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => state.category === "sterile");
  check("arrowing away from a category and back keeps its chosen forms", JSON.stringify(await page.evaluate(() => state.specificForms)) === JSON.stringify(chosen) && chosen.length === 1, JSON.stringify(chosen));

  // A saved project whose benchmark data has since changed (stale results).
  await page.evaluate(() => { if (CURRENT) CURRENT.savedFingerprint = currentFingerprint(); });
  await page.goto("about:blank");
  await page.goto(APP + "#/projects/new");
  await page.waitForSelector("#project-name");
  await page.evaluate(FILL);
  await page.evaluate(() => showStep(4));
  await page.fill("#project-name", "A11y plant");
  await page.click("#project-bar button:has-text('Save project')");
  await page.waitForFunction(() => /^#\/projects\/[0-9a-f-]{36}$/.test(location.hash));
  const id = (await page.evaluate(() => location.hash)).split("/").pop();
  const r = await admin.from("projects").update({ data_hash: "f".repeat(64) }).eq("id", id);
  if (r.error) throw new Error("setup write failed: " + r.error.message);

  for (const v of VIEWPORTS) await scenes(page, v, id);

  await admin.from("projects").delete().eq("id", id);
  check("no console errors (incl. CSP violations)", errors.length === 0, errors.join(" | "));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(2); });
