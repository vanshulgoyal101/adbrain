// #1439: the WS1 first-timer path (step 1 Your business → step 2 Your ads → step 3 Go live) as a production check on
// a 360 px phone over slow 4G, run by the post-deploy guard. Read-only on Meta: every Meta write is blocked, and
// nothing is launched. Step 1 fills only empty fields from a pasted bio, and step 2 makes ads only if the account has none.
//
//   WS1_EMAIL=… WS1_PASSWORD=… npx tsx scripts/ws1-walk.mts [--plant]
//
// WS1_EMAIL must be a confirmed internal address (free image providers, #466) whose business has never gone live.
// --plant injects a promise into step 3 and slows step 2's pictures, so the run must FAIL (proves the checks bite).
import assert from "node:assert/strict";
import { chromium, type CDPSession, type Page } from "@playwright/test";
import { honestCopyFindings } from "../src/lib/copy/honest-copy-rules";

const origin = "https://adbrain.vanshul.com";
const { WS1_EMAIL: email, WS1_PASSWORD: password } = process.env;
const plant = process.argv.includes("--plant");
const LCP_MS = 2500;
const CLS_MAX = 0.1;
const BIO = "Sweet Crumbs Bakery, Mohali Phase 7 | Eggless cakes, brownies and custom birthday cakes | Same-day delivery in Mohali, Chandigarh and Zirakpur | Order on WhatsApp 98140 00000 | Flat 10% off on first order";
assert.ok(email && password, "Set WS1_EMAIL and WS1_PASSWORD.");

const failures: string[] = [];
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures.push(label);
};

/** A cold load of the step's own URL: LCP is only reported for a document load, not a client-side step change. */
let cdp: CDPSession | null = null;
async function vitals(page: Page) {
  await cdp?.send("Network.clearBrowserCache");
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(3000);
  return page.evaluate(() => ({ lcp: Math.round((window as unknown as { __lcp: number }).__lcp), cls: +(window as unknown as { __cls: number }).__cls.toFixed(3) }));
}

/** Visible words outside the ad cards: generated ad text is checked by Create's own claim rules, not here. */
async function chromeText(page: Page) {
  return page.locator("main").evaluate((main) => {
    const clone = main.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("button[aria-pressed]").forEach((b) => b.remove());
    clone.querySelectorAll("img, svg").forEach((n) => n.remove());
    return clone.innerText || clone.textContent || "";
  });
}

const browser = await chromium.launch({ headless: true });
const metaWrites: string[] = [];
try {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  context.setDefaultTimeout(45_000);
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const write = !["GET", "HEAD", "OPTIONS"].includes(request.method());
    // Plan and preflight only read or validate; create, sync and a campaign's own route write to Meta.
    const meta = url.hostname.endsWith("facebook.com")
      || (url.origin === origin && /^\/api\/(meta\/|campaigns\/(create|sync)$|campaigns\/[0-9a-f-]{36}(\/|$))/.test(url.pathname));
    if (write && meta) { metaWrites.push(`${request.method()} ${url.pathname}`); return route.abort("blockedbyclient"); }
    if (plant && (request.resourceType() === "image" || request.resourceType() === "font") && request.frame().url().includes("/create")) {
      await new Promise((resolve) => setTimeout(resolve, 6000));
    }
    return route.continue();
  });
  await context.addInitScript(({ planted }) => {
    const w = window as unknown as { __lcp: number; __cls: number };
    w.__lcp = 0; w.__cls = 0;
    new PerformanceObserver((list) => { for (const e of list.getEntries()) w.__lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => { for (const e of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!e.hadRecentInput) w.__cls += e.value; }).observe({ type: "layout-shift", buffered: true });
    // Re-added after React re-renders, so the planted promise is on the page whenever it's read.
    if (planted && location.pathname === "/campaigns") setInterval(() => {
      const main = document.querySelector("main");
      if (main && !main.querySelector("[data-planted]")) { const p = document.createElement("p"); p.dataset.planted = "1"; p.textContent = "Guaranteed results in 7 days."; main.append(p); }
    }, 200);
  }, { planted: plant });
  const page = await context.newPage();

  await page.goto(`${origin}/login`, { waitUntil: "load" });
  const emailField = page.getByLabel("Email", { exact: true });
  const passwordField = page.getByLabel("Password", { exact: true });
  await emailField.waitFor();
  await page.getByRole("dialog").waitFor({ timeout: 6000 }).then(() => page.getByRole("button", { name: /^Skip/ }).click()).catch(() => {});
  for (let i = 0; i < 5 && !(await passwordField.isVisible()); i++) {
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await passwordField.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
  }
  await emailField.fill(email!);
  await passwordField.fill(password!);
  await page.getByRole("button", { name: "Sign in with password", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));

  cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });

  // Step 1: the five fields, filled from a pasted bio where empty.
  await page.goto(`${origin}/brand`, { waitUntil: "load" });
  const step1 = await page.getByText(/Step 1 of 3/).isVisible().catch(() => false);
  check(step1, "Step 1 'Your business' shows for a first-timer");
  if (!step1) throw new Error("The account isn't in setup mode (a campaign went live?). Use an account that has never gone live.");
  const v1 = await vitals(page);
  check(v1.lcp > 0 && v1.lcp <= LCP_MS && v1.cls <= CLS_MAX, "Step 1 LCP/CLS", `LCP ${v1.lcp} ms, CLS ${v1.cls}`);
  const fields = ["#setup-name", "#setup-vertical", "#setup-locations", "#setup-offer", "#setup-phone"];
  const empty = async () => (await Promise.all(fields.map(async (f) => ((await page.locator(f).inputValue().catch(() => "")).trim() ? null : f)))).filter(Boolean);
  if ((await empty()).length) {
    await page.getByRole("button", { name: /No website\? Paste a bio/ }).click();
    await page.locator("textarea").first().fill(BIO);
    await page.getByRole("button", { name: /Fill from this text/ }).click();
    for (let i = 0; i < 60 && (await empty()).length; i++) await page.waitForTimeout(1000);
  }
  const missing = await empty();
  check(!missing.length, "Step 1 five fields filled", missing.join(", "));
  const words1 = honestCopyFindings(await chromeText(page));
  check(!words1.length, "Step 1 honest copy", words1.join("; "));
  await page.getByRole("button", { name: /Make my ads/ }).or(page.getByRole("link", { name: /Make my ads/ })).first().click();
  await page.waitForURL(/\/create/, { timeout: 60_000 });

  // Step 2: ads (made now only if there are none), the best 2 picked; then a cold load for vitals.
  const ready = page.getByText(/Your ads are ready|couldn.t be made|went wrong/i).first();
  await ready.waitFor({ timeout: 330_000 });
  await page.getByText(/Step 2 of 3/).waitFor();
  const v2 = await vitals(page);
  check(v2.lcp > 0 && v2.lcp <= LCP_MS && v2.cls <= CLS_MAX, "Step 2 LCP/CLS", `LCP ${v2.lcp} ms, CLS ${v2.cls}`);
  const picked = await page.locator("main button[aria-pressed=true]").count();
  check(picked >= 2, "Step 2 picks the best 2", `${picked} picked`);
  const words2 = honestCopyFindings(await chromeText(page));
  check(!words2.length, "Step 2 honest copy", words2.join("; "));
  await page.getByRole("button", { name: /^Continue with \d+ ads?$/ }).or(page.getByRole("link", { name: /^Continue with \d+ ads?$/ })).first().click();
  await page.waitForURL(/\/campaigns/, { timeout: 60_000 });

  // Step 3: what goes live and what it costs, before anything is sent to Meta.
  await page.getByText(/Step 3 of 3/).waitFor();
  const v3 = await vitals(page);
  check(v3.lcp > 0 && v3.lcp <= LCP_MS && v3.cls <= CLS_MAX, "Step 3 LCP/CLS", `LCP ${v3.lcp} ms, CLS ${v3.cls}`);
  const text3 = await page.locator("main").innerText();
  check(/Stops at ₹[\d,]+/.test(text3), "Step 3 shows the cap ('Stops at ₹…')");
  check(/Facebook Page/.test(text3) && /payment/i.test(text3), "Step 3 shows Connect Facebook Page and payment");
  check(/AdBrain never holds your ad money|Your ad budget stays yours/.test(text3) || !/Connect Facebook Page/.test(text3), "Step 3 trust line at Connect");
  const words3 = honestCopyFindings(await chromeText(page));
  check(!words3.length, "Step 3 honest copy", words3.join("; "));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check(overflow <= 0, "Step 3 no horizontal overflow", `${overflow}px`);
} catch (error) {
  check(false, "WS1 walk ran to the end", error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : String(error));
} finally {
  await browser.close();
}
check(!metaWrites.length, "No Meta write attempted", metaWrites.join(", "));
console.log(failures.length ? `WS1 walk FAILED: ${failures.length} check(s)` : "WS1 walk PASSED");
process.exitCode = failures.length ? 1 : 0;
