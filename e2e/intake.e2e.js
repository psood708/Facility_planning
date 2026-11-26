// PDF intake in a real browser under the production CSP: a typed PDF (text
// layer) and an image-only "scanned" PDF (OCR) are read in the page, reviewed
// and applied; Cancel and a fake PDF change nothing. The PDFs are generated
// here with Chromium's print-to-PDF, so no binary fixtures live in the repo.
// Same prerequisites as the other e2e files (local Supabase + npm run serve:dist).
// Run: npm run test:e2e
const fs = require("node:fs");
const { APP, launch, check, signIn, collectErrors, uniqueEmail } = require("./lib.js");

const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const SHEET = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { font: 15px Arial, sans-serif; margin: 40px; color: #000; background: #fff; }
  h1 { font-size: 20px; } table { border-collapse: collapse; margin-top: 18px; }
  th, td { text-align: left; padding: 8px 14px; border-bottom: 1px solid #999; }
</style></head><body>
  <h1>Room data sheet — sterile injectables facility</h1>
  <p>Design basis for USFDA and EU GMP.</p>
  <table id="sheet">
    <tr><th>Room</th><th>Area (m²)</th><th>Grade</th><th>Temp (°C)</th><th>RH (%)</th><th>ΔP (Pa)</th></tr>
    <tr><td>Aseptic Filling Suite (Vials/Ampoules/PFS/Cartridge)</td><td>120</td><td>Grade B</td><td>18-22</td><td>45-55</td><td>30</td></tr>
    <tr><td>Dispensing / Weighing Room</td><td>18.5</td><td>Grade D</td><td>20-25</td><td>NMT 60</td><td>15</td></tr>
    <tr><td>Vial Capping / Crimping Room</td><td>24</td><td>Grade C</td><td>20-24</td><td>40-60</td><td>10</td></tr>
  </table>
</body></html>`;

async function audit(page, scene) {
  await page.evaluate(AXE);
  const violations = await page.evaluate(async (tags) => {
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, count: v.nodes.length, first: v.nodes[0] && v.nodes[0].target.join(" ") }));
  }, TAGS);
  const width = page.viewportSize().width;
  check(`${scene} @${width}: no axe violations`, violations.length === 0, violations.map((v) => `${v.id} (${v.impact}, ${v.count}× e.g. ${v.first})`).join("; "));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${scene} @${width}: no horizontal page scroll`, overflow <= 0, `overflows by ${overflow}px`);
}

async function makePdfs(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const p = await ctx.newPage();
  await p.setContent(SHEET);
  const typed = await p.pdf({ format: "A4", printBackground: true });
  const png = await p.screenshot({ fullPage: true });
  await p.setContent(`<!doctype html><html><body style="margin:0"><img src="data:image/png;base64,${png.toString("base64")}" style="width:100%"></body></html>`);
  await p.waitForFunction(() => document.images[0] && document.images[0].complete);
  const scanned = await p.pdf({ format: "A4", printBackground: true });
  await ctx.close();
  return { typed, scanned };
}

const reviewRows = (page) => page.$$eval("#step-1 .intake-row", (rows) => rows.map((r) => r.textContent.replace(/\s+/g, " ").trim()));
const stateJson = (page) => page.evaluate(() => JSON.stringify(ProjectState.serializeInputs(state)));

async function openWizard(page) {
  await page.goto("about:blank");
  await page.goto(APP + "#/projects/new");
  await page.waitForSelector("#step-1:not([hidden]) .intake-panel input[type=file]");
}

(async () => {
  const browser = await launch();
  const { typed, scanned } = await makePdfs(browser);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = collectErrors(page);
  await signIn(page, uniqueEmail("intake"));
  await openWizard(page);

  // ---- typed PDF: text layer, no OCR
  const before = await stateJson(page);
  await page.setInputFiles("#step-1 .intake-panel input[type=file]", { name: "room-data-sheet.pdf", mimeType: "application/pdf", buffer: typed });
  await page.waitForSelector("#step-1 .intake-review", { timeout: 60000 });
  let rows = await reviewRows(page);
  const has = (re) => rows.some((r) => re.test(r));
  check("typed PDF: rooms and their values are proposed with the page they came from",
    has(/Room Net Area: 120 m²/) && has(/Room Net Area: 18\.5 m²/) && has(/Cleanroom Grade \/ ISO Class: Grade B/) && has(/Temperature: 18–22 °C/) && has(/p\.1:/), rows.slice(0, 6).join(" | "));
  check("typed PDF: category and markets are proposed too", has(/Dosage form category: Sterile/) && has(/Target market: US FDA/) && has(/Target market: EU-GMP/), rows.slice(0, 4).join(" | "));
  check("nothing is filled before the planner confirms", (await stateJson(page)) === before);
  await audit(page, "PDF review screen");
  await page.setViewportSize({ width: 390, height: 844 });
  await audit(page, "PDF review screen");
  await page.setViewportSize({ width: 1440, height: 900 });

  // Untick the capping room's area, then fill.
  const capping = page.locator("#step-1 .intake-row", { hasText: "Room Net Area: 24 m²" }).locator("input[type=checkbox]");
  if (await capping.isChecked()) await capping.uncheck();
  await page.click("#step-1 .intake-review button:has-text('Fill the selected')");
  await page.waitForSelector("#step-1 .intake-panel h3:has-text('Values filled')");
  const after = await page.evaluate(() => ({ cat: state.category, rooms: state.selectedRooms.slice(), rv: JSON.parse(JSON.stringify(state.roomValues)) }));
  check("Fill applies the ticked values through validation: rooms, areas, grades, ranges",
    after.cat === "sterile" && after.rooms.includes("Z-29") && (after.rv["Z-29"] || {})["DIM-001"] === 120 && (after.rv["Z-29"] || {})["HVAC-001"] === "Grade B"
      && JSON.stringify((after.rv["Z-29"] || {})["HVAC-002"]) === JSON.stringify({ min: 18, max: 22 }) && (after.rv["Z-07"] || {})["DIM-001"] === 18.5, JSON.stringify(after).slice(0, 300));
  check("an unticked value is not filled", !(after.rv["Z-34"] && after.rv["Z-34"]["DIM-001"] === 24));
  check("focus moves to the summary", await page.evaluate(() => !!document.activeElement && /Values filled/.test(document.activeElement.textContent)));
  await page.click("#step-1 .intake-panel button:has-text('Go to Step 3')");
  await page.waitForSelector("#step-3:not([hidden])");
  check("Step 3 says which fields came from the PDF", (await page.locator("#step-3 .intake-from").count()) > 0);

  // ---- a new project starts clean: no leftover review, summary or "From PDF" notes
  await page.evaluate(() => { if (CURRENT) CURRENT.savedFingerprint = currentFingerprint(); });
  await openWizard(page); // waits for the upload panel, i.e. not the old summary
  check("a new project starts with no PDF state from the previous one", await page.evaluate(() => intake.phase === "idle" && intakeNotes.size === 0));

  // ---- scanned (image-only) PDF: OCR in the browser
  await page.evaluate(() => { if (CURRENT) CURRENT.savedFingerprint = currentFingerprint(); });
  await openWizard(page);
  await page.setInputFiles("#step-1 .intake-panel input[type=file]", { name: "scan.pdf", mimeType: "application/pdf", buffer: scanned });
  await page.waitForSelector("#step-1 .intake-progress-text:has-text('OCR')", { timeout: 60000 });
  check("scanned PDF: the page is read with OCR (no text layer)", true);
  await page.waitForSelector("#step-1 .intake-review", { timeout: 180000 });
  rows = await reviewRows(page);
  const areas = [/Room Net Area: 120 m²/, /Room Net Area: 18\.5 m²/, /Room Net Area: 24 m²/].filter((re) => rows.some((r) => re.test(r))).length;
  check(`scanned PDF: OCR still finds the room areas (${areas} of 3)`, areas >= 2, rows.slice(0, 8).join(" | "));

  // ---- Cancel during OCR changes nothing
  await openWizard(page);
  const beforeCancel = await stateJson(page);
  await page.setInputFiles("#step-1 .intake-panel input[type=file]", { name: "scan.pdf", mimeType: "application/pdf", buffer: scanned });
  await page.waitForSelector("#step-1 .intake-progress-text:has-text('OCR')", { timeout: 60000 });
  await page.click("#step-1 .intake-panel button:has-text('Cancel')");
  await page.waitForSelector("#step-1 .intake-panel input[type=file]");
  check("Cancel returns to the upload panel and changes nothing", (await stateJson(page)) === beforeCancel);

  // ---- not a PDF
  await page.setInputFiles("#step-1 .intake-panel input[type=file]", { name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("just some text, not a PDF") });
  await page.waitForSelector("#step-1 .intake-error");
  check("a file that isn't a PDF says so", /isn't a PDF/.test(await page.textContent("#step-1 .intake-error")));

  await page.evaluate(() => { if (CURRENT) CURRENT.savedFingerprint = currentFingerprint(); });
  check("no console errors (incl. CSP violations)", errors.length === 0, errors.join(" | "));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(2); });
