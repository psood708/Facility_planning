// Browser end-to-end: email-link sign-in against the real app and local Supabase.
// Needs: `npx supabase start`, the app served at http://127.0.0.1:8000
// (`python3 -m http.server 8000 --bind 127.0.0.1`), and a Chromium:
// CHROME_PATH=/path/to/chrome, or one installed by `npx playwright install chromium`.
// Run: npm run test:e2e
const { APP, launch, check, linkFor, collectErrors, uniqueEmail } = require("./lib.js");

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = collectErrors(page);

  await page.goto(APP + "#/projects");
  await page.waitForSelector("#view-signin:not([hidden]) form");
  check("signed-out visit to #/projects shows sign-in", true);
  check("wizard step bar and Back/Next are not visible on sign-in", !(await page.isVisible("#step-indicator")) && !(await page.isVisible("#wizard-nav")));
  check("vendored supabase-js loaded (integrity ok)", await page.evaluate(() => typeof window.supabase?.createClient === "function"));

  await page.fill("#signin-email", "not-an-email");
  await page.click("form.signin-form button");
  check("bad email rejected in page", /valid email/.test(await page.textContent("#view-signin .notice[role=status]")));

  const email = uniqueEmail("e2e");
  await page.fill("#signin-email", email);
  await page.click("form.signin-form button");
  await page.waitForFunction(() => /inbox/.test(document.querySelector("#view-signin .notice[role=status]")?.textContent || ""));
  check("link requested → 'check your inbox'", true);

  const { href, subject } = await linkFor(email);
  check("email arrived", !!href, subject);
  await page.goto(href);
  await page.waitForSelector("#view-projects:not([hidden])", { timeout: 15000 });
  const url = page.url();
  check("email link signs in and lands on projects", true, url);
  check("wizard chrome hidden on projects page", !(await page.isVisible("#step-indicator")) && !(await page.isVisible("#wizard-nav")));
  check("R15: no code/token left in the URL", !/[?&#](code|access_token|refresh_token|token)=/.test(url), url);
  check("account bar shows the signed-in email", (await page.textContent("#account-bar")).includes(email));

  await page.reload();
  await page.waitForSelector("#view-projects:not([hidden])");
  check("session survives reload", true);

  // Reusing the same link in a fresh browser must fail (single use).
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(href);
  await p2.waitForSelector("#view-signin:not([hidden])", { timeout: 15000 });
  check("reused link is refused and explained", /expired or was already used/.test(await p2.textContent("#view-signin")));
  check("refused link leaves no auth params in URL", !/[?&#](error|error_code|error_description|code|sb)=/.test(p2.url()), p2.url());
  await ctx2.close();

  await page.click("#account-bar button");
  await page.waitForSelector("#view-signin:not([hidden])");
  check("sign out returns to sign-in", true);
  await page.goto(APP + "#/projects");
  await page.waitForSelector("#view-signin:not([hidden])");
  check("after sign out, projects are behind sign-in again", true);

  check("no console errors", errors.length === 0, errors.join(" | "));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(2); });
