// Shared helpers for the browser end-to-end tests (see e2e/*.e2e.js).
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright-core");

const APP = "http://127.0.0.1:8000/";
const MAIL = "http://127.0.0.1:54324/api/v1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// CHROME_PATH, else the newest Chromium cached by `npx playwright install chromium`.
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = path.join(process.env.HOME || "", "Library/Caches/ms-playwright");
  const builds = fs.existsSync(cache) ? fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => b.split("-")[1] - a.split("-")[1]) : [];
  for (const b of builds) {
    const exe = path.join(cache, b, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (fs.existsSync(exe)) return exe;
  }
  return undefined;
}

// Reduced motion: no smooth scrolling, so clicks never land mid-scroll.
async function launch() {
  const browser = await chromium.launch({ executablePath: findChrome() });
  const newContext = browser.newContext.bind(browser);
  browser.newContext = (opts = {}) => newContext({ reducedMotion: "reduce", ...opts });
  return browser;
}

function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
  if (!ok) process.exitCode = 1;
}

// The sign-in link from the local Mailpit inbox.
async function linkFor(email) {
  for (let i = 0; i < 40; i++) {
    const s = await (await fetch(`${MAIL}/search?query=${encodeURIComponent("to:" + email)}`)).json();
    if (s.messages && s.messages.length) {
      const m = await (await fetch(`${MAIL}/message/${s.messages[0].ID}`)).json();
      return { href: (m.HTML || m.Text).match(/https?:\/\/[^"'\s<>]+verify[^"'\s<>]+/)[0].replace(/&amp;/g, "&"), subject: m.Subject };
    }
    await sleep(300);
  }
  throw new Error("no sign-in email for " + email);
}

// Sign in through the real UI. Returns the page on the projects view.
async function signIn(page, email) {
  await page.goto(APP + "#/signin");
  await page.waitForSelector("#view-signin:not([hidden]) form");
  await page.fill("#signin-email", email);
  await page.click("form.signin-form button");
  await page.waitForFunction(() => /inbox/.test(document.querySelector("#view-signin .notice[role=status]")?.textContent || ""));
  const { href } = await linkFor(email);
  await page.goto(href);
  await page.waitForSelector("#view-projects:not([hidden])", { timeout: 15000 });
  return href;
}

function collectErrors(page) {
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

const uniqueEmail = (label) => `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`;

module.exports = { APP, launch, check, linkFor, signIn, collectErrors, uniqueEmail, sleep };
