// Browser end-to-end: saved projects — save, list, open, rename, deletion
// warnings and Keep, stale data and Re-evaluate, delete, and isolation.
// Same prerequisites as signin.e2e.js. Run: npm run test:e2e
const { APP, launch, check, signIn, collectErrors, uniqueEmail } = require("./lib.js");
const { admin: rawAdmin } = require("../db-tests/helpers.js");
// Fail loudly if a setup write through the service role does not apply.
const admin = { from: (t) => rawAdmin.from(t) };
async function must(q) { const r = await q; if (r.error) throw new Error("setup write failed: " + r.error.message); return r; }

const DAY = 24 * 3600 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();
const NAME = 'E2E plant <img src=x onerror="window.__xss=1">';

// The wizard UI itself predates accounts; fill its state directly and render.
async function fillWizard(page) {
  await page.evaluate(() => {
    Object.assign(state, {
      category: "sterile", specificForms: ["Sterile Liquid (Vial)"], targetMarkets: ["schedule_m", "eu_gmp"],
      selectedRooms: ["Z-29"], facilityValues: { "UTIL-001": "Class 2" },
      roomValues: { "Z-29": { "DIM-001": 120, "HVAC-001": "Grade B", "HVAC-002": { min: 19, max: 24 } } },
    });
    showStep(4);
  });
}
const rowFor = (page, id) => page.locator(`.project-row:has(a[href="#/projects/${id}"])`);
// Full page load each time: goto to the URL the page is already on is a no-op,
// which would leave a stale list on screen.
async function openList(page) {
  await page.goto("about:blank");
  await page.goto(APP + "#/projects");
  await page.waitForSelector("#view-projects:not([hidden]) .project-list, #view-projects:not([hidden]) .empty-state");
}

(async () => {
  const browser = await launch();
  const page = await (await browser.newContext()).newPage();
  const errors = collectErrors(page);
  await signIn(page, uniqueEmail("proj-a"));

  await page.waitForSelector("#view-projects .empty-state, #view-projects .project-list"); // list loads after the view appears
  check("new account sees the empty state", await page.isVisible("#view-projects .empty-state"));

  // ---- primary authority (Milestone 3)
  await page.click("text=New project");
  await page.waitForSelector('#step-1 input[name="primaryAuthority"]');
  check("authorities without data can't be chosen", (await page.isDisabled("#mkt-uk_mhra")) && (await page.isDisabled("#mkt-sfda")) && (await page.isDisabled("#mkt-tga_australia")) && (await page.isDisabled("#mkt-sahpra")));
  await page.check("#mkt-us_fda");
  check("primary authority is offered from the chosen covered markets only", (await page.locator('input[name="primaryAuthority"]').count()) === 2);
  await page.check('input[name="primaryAuthority"][value="us_fda"]');
  check("choosing the primary authority updates the project", (await page.evaluate(() => state.primaryAuthority)) === "us_fda");
  await page.evaluate(() => { Object.assign(state, { category: "sterile", specificForms: ["Sterile Liquid (Vial)"], selectedRooms: ["Z-29"], roomValues: { "Z-29": { "DIM-001": 120 } } }); showStep(4); });
  await page.waitForSelector("#step-4 .auth-view h3");
  check("results lead with the primary authority", /Against US FDA/.test(await page.textContent("#step-4 .auth-view h3")));
  check("one requirement table per room, each with statuses", (await page.locator("#step-4 .auth-table").count()) >= 2 && (await page.locator("#step-4 .auth-status").count()) > 0);
  await page.click('#step-4 .auth-choice:has-text("Schedule M")');
  await page.waitForFunction(() => /Schedule M/.test(document.querySelector("#step-4 .auth-view h3").textContent));
  check("the switcher shows another authority without changing the project", (await page.evaluate(() => state.primaryAuthority)) === "us_fda");
  check("Schedule M shows the 120 m² room against its 150 m² minimum as Fail", /Fail/.test(await page.locator("#step-4 .auth-row.st-fail").first().textContent()));
  // ---- cross-authority gap report (Milestone 4)
  check("the gap report compares all six covered authorities", (await page.locator("#step-4 .scorecard").count()) === 6);
  check("the planner's two target markets are marked", (await page.locator("#step-4 .scorecard .target-badge").count()) === 2);
  const groups = await page.locator("#step-4 .gap-group > h4").allTextContents();
  check("gaps are grouped (mandatory / recommended / not yet classified / advisory)", groups.length > 0 && groups.every((g) => /Mandatory|Recommendations|Not yet classified|international standard/i.test(g)), groups.join(" | "));
  const changes = await page.locator("#step-4 .fix-row .fix-change").allTextContents();
  check("every gap shows a concrete suggested change", changes.length > 0 && changes.every((t) => /^(Increase|Decrease|Adjust|Upgrade|Add|Set|Change)\b/.test(t.trim())), changes.join(" | "));
  await page.evaluate(() => { CURRENT.savedFingerprint = currentFingerprint(); }); // discard this throwaway project
  await openList(page);

  // ---- create
  await page.click("text=New project");
  await page.waitForSelector("#view-wizard:not([hidden]) #project-bar:not([hidden])");
  await fillWizard(page);
  await page.fill("#project-name", NAME);
  await page.click("#project-bar button:has-text('Save project')");
  await page.waitForFunction(() => /^#\/projects\/[0-9a-f-]{36}$/.test(location.hash));
  const id = (await page.evaluate(() => location.hash)).split("/").pop();
  check("saving a new project gives it its own address", !!id, id);
  check("save confirmation shown", /Saved/.test(await page.textContent("#project-bar .save-status")));

  // ---- list + XSS-looking name
  await openList(page);
  const link = rowFor(page, id).locator("a.project-name");
  check("project appears in the list", (await link.count()) === 1);
  check("name is shown as text, not markup", (await link.textContent()) === NAME && (await page.locator(".project-row img").count()) === 0);
  check("no script ran from the name", (await page.evaluate(() => window.__xss)) === undefined);

  // ---- open → results current, no banners
  await link.click();
  await page.waitForSelector("#step-4:not([hidden]) h2");
  check("complete project opens on its results", /Compliance Results/.test(await page.textContent("#step-4 h2")));
  check("no stale or deletion banner on a fresh project", !(await page.isVisible(".stale-banner")) && !(await page.isVisible(".deletion-banner")));

  // ---- rename
  await page.fill("#project-name", "Renamed plant");
  await page.click("#project-bar button:has-text('Save changes')");
  await page.waitForFunction(() => /Saved/.test(document.querySelector("#project-bar .save-status")?.textContent || ""));
  await openList(page);
  check("rename is saved", (await rowFor(page, id).locator("a.project-name").textContent()) === "Renamed plant");

  // ---- unsaved changes
  await rowFor(page, id).locator("a.project-name").click();
  await page.waitForSelector("#project-name");
  check("no unsaved-changes flag right after opening", !(await page.isVisible("#project-bar .unsaved-flag")));
  await page.fill("#project-name", "Unsaved name");
  check("editing shows 'Unsaved changes'", await page.isVisible("#project-bar .unsaved-flag"));
  check("closing/reloading the tab would prompt (beforeunload)", await page.evaluate(() => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; }));
  await page.click("#project-bar a.back-link");
  await page.waitForSelector(".unsaved-guard");
  check("leaving asks first and keeps the project on screen", (await page.evaluate(() => location.hash)) === `#/projects/${id}` && (await page.isVisible("#view-wizard")));
  await page.click(".unsaved-guard button:has-text('Stay')");
  check("Stay keeps the edit", !(await page.isVisible(".unsaved-guard")) && (await page.inputValue("#project-name")) === "Unsaved name");
  // A change made in the wizard itself (not the name) also counts.
  await page.fill("#project-name", "Renamed plant");
  check("undoing the edit clears the flag", !(await page.isVisible("#project-bar .unsaved-flag")));
  for (let i = 0; i < 3; i++) await page.click("#btn-back");
  await page.waitForSelector("#step-1:not([hidden]) .market-grid");
  await page.locator("#step-1 .market-grid input[type=checkbox]:not(:checked)").first().check();
  await page.waitForSelector("#project-bar .unsaved-flag:not([hidden])");
  check("changing a wizard field shows 'Unsaved changes'", true);
  await page.click("#account-bar a:has-text('My projects')");
  await page.waitForSelector(".unsaved-guard");
  await page.click(".unsaved-guard button:has-text('Discard changes')");
  await page.waitForSelector("#view-projects:not([hidden]) .project-list");
  check("Discard leaves without saving", (await rowFor(page, id).locator("a.project-name").textContent()) === "Renamed plant");
  await rowFor(page, id).locator("a.project-name").click();
  await page.waitForSelector("#project-name");
  await page.fill("#project-name", "Saved on the way out");
  await page.click("#project-bar a.back-link");
  await page.waitForSelector(".unsaved-guard");
  await page.click(".unsaved-guard button:has-text('Save and leave')");
  await page.waitForSelector("#view-projects:not([hidden]) .project-list");
  check("Save and leave saves, then leaves", (await rowFor(page, id).locator("a.project-name").textContent()) === "Saved on the way out");
  check("a clean project does not prompt on unload", await page.evaluate(() => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return !e.defaultPrevented; }));

  // ---- warning: 5 months 20 days since last edit
  await must(admin.from("projects").update({ last_edited_at: ago(172) }).eq("id", id));
  await openList(page);
  check("amber hint within 30 days of being flagged", await rowFor(page, id).locator(".row-hint").isVisible());

  // ---- flagged: red badge, sorted first, banner on open, Keep
  const { data: second } = await admin.from("projects").select("*").eq("id", id).single();
  const other = await must(admin.from("projects").insert({ ...second, id: undefined, name: "Unflagged newer", last_edited_at: new Date().toISOString(), flagged_for_deletion_at: null }).select().single());
  await must(admin.from("projects").update({ last_edited_at: ago(200), flagged_for_deletion_at: ago(20) }).eq("id", id));
  await openList(page);
  const first = page.locator(".project-row").first();
  check("flagged project is sorted to the top", (await first.locator("a.project-name").getAttribute("href")) === `#/projects/${id}`);
  check("flagged row has a red badge with days left", /Deletes .* · 10 days left/.test(await first.locator(".badge-danger").textContent()));
  await first.locator("a.project-name").click();
  await page.waitForSelector(".deletion-banner");
  check("opening a flagged project shows the full-width banner", /permanently deleted on/.test(await page.textContent(".deletion-banner")));
  const flaggedBefore = (await admin.from("projects").select("flagged_for_deletion_at").eq("id", id).single()).data.flagged_for_deletion_at;
  check("opening alone does not un-flag (not an edit)", flaggedBefore !== null);
  await page.click(".deletion-banner button:has-text('Keep this project')");
  await page.waitForFunction(() => !document.querySelector(".deletion-banner"));
  check("Keep removes the banner", /Kept/.test(await page.textContent("#project-bar .save-status")));
  check("Keep un-flagged it in the database", (await admin.from("projects").select("flagged_for_deletion_at").eq("id", id).single()).data.flagged_for_deletion_at === null);
  await openList(page);
  check("list no longer shows a deletion badge", (await rowFor(page, id).locator(".badge-danger").count()) === 0);

  // ---- stale: saved with different benchmark data
  await must(admin.from("projects").update({ data_hash: "f".repeat(64) }).eq("id", id));
  await rowFor(page, id).locator("a.project-name").click();
  await page.waitForSelector(".stale-banner");
  check("stale project explains the data changed", /benchmark data has been updated/i.test(await page.textContent(".stale-banner")));
  check("stale project shows results as saved (read-only)", /Results as saved/.test(await page.textContent("#step-4")) && (await page.locator("#step-4 input, #step-4 select").count()) === 0);
  await page.click(".stale-banner button:has-text('Re-evaluate')");
  await page.waitForSelector("#step-4 h2:has-text('Compliance Results')");
  check("Re-evaluate shows live results", true);
  await page.click("#project-bar button:has-text('Save changes')");
  await page.waitForFunction(() => /Saved/.test(document.querySelector("#project-bar .save-status")?.textContent || ""));
  await page.reload();
  await page.waitForSelector("#step-4:not([hidden]) h2");
  check("after saving, the project is current again", !(await page.isVisible(".stale-banner")));

  // ---- isolation: another account cannot open it
  const pageB = await (await browser.newContext()).newPage();
  const errorsB = collectErrors(pageB);
  await signIn(pageB, uniqueEmail("proj-b"));
  await pageB.goto(APP + "#/projects/" + id);
  await pageB.waitForSelector("#view-message:not([hidden]) h2:has-text('Project not found')");
  check("another account gets 'Project not found' for the same link", true);
  await pageB.goto(APP + "#/projects/00000000-0000-4000-8000-000000000000");
  await pageB.waitForSelector("#view-message:not([hidden]) h2:has-text('Project not found')");
  check("…exactly like a nonexistent project", true);

  // ---- delete (two-step)
  await openList(page);
  await rowFor(page, id).locator("button:has-text('Delete')").first().click();
  check("delete asks for confirmation first", await rowFor(page, id).locator(".confirm-delete").isVisible());
  await rowFor(page, id).locator("button:has-text('Delete permanently')").click();
  await page.waitForFunction((pid) => !document.querySelector(`a[href="#/projects/${pid}"]`), id);
  check("project is deleted", (await admin.from("projects").select("id").eq("id", id)).data.length === 0);
  await admin.from("projects").delete().eq("id", other.data.id);

  check("no console errors", errors.length + errorsB.length === 0, errors.concat(errorsB).join(" | "));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(2); });
