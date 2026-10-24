/**
 * #417 UI gate: screenshots, axe-core violations and Core Web Vitals (LCP, CLS) for the homepage,
 * sign-in and the six owner screens at 390 and 1440 px. Signs in with the smoke account; every
 * write is blocked, so it is read-only.
 *
 *   npm run ui-gate -- --out .superpowers/ui-gate/before                    # production baseline
 *   npm run ui-gate -- --origin http://localhost:3000 --out .superpowers/ui-gate/after
 *   npm run ui-gate -- --compare .superpowers/ui-gate/before --out .superpowers/ui-gate/after
 *
 * --compare exits 1 if any page has more axe violations, LCP worse by over 20% and 250 ms, or CLS
 * worse by over 0.05 than the baseline (the #416 rule: after must be at least as good as before).
 */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs, parseEnv } from "node:util";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const { values: args } = parseArgs({
  options: {
    origin: { type: "string", default: "https://adbrain.vanshul.com" },
    out: { type: "string", default: ".superpowers/ui-gate/run" },
    compare: { type: "string" },
    "compare-only": { type: "boolean", default: false },
  },
});
const origin = new URL(args.origin).origin;
assert.ok(origin === "https://adbrain.vanshul.com" || new URL(origin).hostname === "localhost", "The gate runs against production or localhost only.");

const PUBLIC_PAGES = [["home", "/"], ["login", "/login"]];
const OWNER_PAGES = [["dashboard", "/dashboard"], ["brand", "/brand"], ["create", "/create"], ["review", "/studio"], ["campaigns", "/campaigns"], ["enquiries", "/leads"]];
const VIEWPORTS = [[390, 844], [1440, 900]];

async function credentials() {
  if (process.env.SMOKE_EMAIL && process.env.SMOKE_PASSWORD) return { email: process.env.SMOKE_EMAIL, password: process.env.SMOKE_PASSWORD };
  const path = process.env.SMOKE_ENV_FILE ?? "/Users/vanshulgoyal/Development/copilot/adbrain/.env.smoke";
  const env = parseEnv(await readFile(path, "utf8"));
  assert.ok(env.SMOKE_EMAIL && env.SMOKE_PASSWORD, "Set SMOKE_EMAIL and SMOKE_PASSWORD (or the ignored .env.smoke).");
  return { email: env.SMOKE_EMAIL, password: env.SMOKE_PASSWORD };
}

/** Allows reads and the one password sign-in; answers background syncs and telemetry locally. */
async function readOnly(context) {
  let loginAllowed = true;
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST" && url.origin === origin && url.pathname === "/api/leads/sync") {
      return route.fulfill({ json: { leads: [], imported: 0, sync: { id: "ui-gate", state: "partial", hasMore: true } } });
    }
    if (request.method() === "POST" && url.origin === origin && ["/api/campaigns/sync", "/api/events"].includes(url.pathname)) return route.fulfill({ status: 204, body: "" });
    if (request.method() === "POST" && url.hostname.endsWith(".supabase.co") && url.pathname === "/rest/v1/web_events") return route.fulfill({ status: 201, json: [] });
    if (request.method() === "POST" && loginAllowed && url.hostname.endsWith(".supabase.co") && url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
      loginAllowed = false;
      return route.continue();
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) return route.abort("blockedbyclient");
    if (url.origin === origin && (/^\/api\/(cron|scheduler)\//.test(url.pathname) || url.pathname.startsWith("/api/meta/oauth/"))) return route.abort("blockedbyclient");
    return route.continue();
  });
}

async function signIn(page, { email, password }) {
  await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded" });
  const passwordField = page.getByLabel("Password", { exact: true });
  await page.getByLabel("Email", { exact: true }).waitFor();
  for (let attempt = 0; attempt < 5 && !(await passwordField.isVisible()); attempt++) {
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await passwordField.waitFor({ state: "visible", timeout: 3_000 }).catch(() => {});
  }
  await page.getByLabel("Email", { exact: true }).fill(email);
  await passwordField.fill(password);
  await page.getByRole("button", { name: "Sign in with password", exact: true }).click();
  await page.waitForURL((url) => url.origin === origin && !url.pathname.startsWith("/login"));
}

async function measure(page, path, file) {
  await page.addInitScript(() => {
    window.__vitals = { lcp: 0, cls: 0 };
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__vitals.lcp = entry.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__vitals.cls += entry.value; }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto(`${origin}${path}`, { waitUntil: "load" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(1_500);
  const vitals = await page.evaluate(() => window.__vitals);
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: file, fullPage: true });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const violations = axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, targets: v.nodes.slice(0, 10).map((n) => n.target.join(" ")) }));
  return { lcpMs: Math.round(vitals.lcp), cls: Number(vitals.cls.toFixed(3)), axe: violations.reduce((sum, v) => sum + v.nodes, 0), violations };
}

async function run() {
  await mkdir(args.out, { recursive: true });
  const browser = await chromium.launch();
  const report = { origin, ranAt: new Date().toISOString(), pages: {} };
  try {
    const login = await credentials();
    for (const [width, height] of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, serviceWorkers: "block", ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
      context.setDefaultTimeout(30_000);
      await readOnly(context);
      for (const [name, path] of PUBLIC_PAGES) {
        const page = await context.newPage();
        // A first visit on a phone opens the sign-up intro; the gate measures the page under it.
        await page.addInitScript(() => localStorage.setItem("adbrain:login-intro-seen", "1"));
        report.pages[`${name}@${width}`] = await measure(page, path, join(args.out, `${name}-${width}.png`));
        await page.close();
      }
      const auth = await context.newPage();
      await signIn(auth, login);
      await auth.close();
      for (const [name, path] of OWNER_PAGES) {
        const page = await context.newPage();
        report.pages[`${name}@${width}`] = await measure(page, path, join(args.out, `${name}-${width}.png`));
        await page.close();
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
  await writeFile(join(args.out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function compare(before, after) {
  let failed = false;
  console.log("page".padEnd(20), "axe before→after".padEnd(18), "LCP ms before→after".padEnd(22), "CLS before→after");
  for (const [key, b] of Object.entries(before.pages)) {
    const a = after.pages[key];
    if (!a) { console.log(key.padEnd(20), "missing in after"); failed = true; continue; }
    const worse = [];
    if (a.axe > b.axe) worse.push("axe");
    if (a.lcpMs > b.lcpMs * 1.2 && a.lcpMs - b.lcpMs > 250) worse.push("LCP");
    if (a.cls > b.cls + 0.05) worse.push("CLS");
    if (worse.length) failed = true;
    console.log(key.padEnd(20), `${b.axe}→${a.axe}`.padEnd(18), `${b.lcpMs}→${a.lcpMs}`.padEnd(22), `${b.cls}→${a.cls}`, worse.length ? `WORSE: ${worse.join(", ")}` : "");
  }
  return failed;
}

const report = args["compare-only"] && existsSync(join(args.out, "report.json")) ? JSON.parse(await readFile(join(args.out, "report.json"), "utf8")) : await run();
if (args.compare) {
  const before = JSON.parse(await readFile(join(args.compare, "report.json"), "utf8"));
  if (compare(before, report)) { console.log("UI gate: WORSE than baseline"); process.exitCode = 1; } else console.log("UI gate: not worse than baseline");
} else {
  for (const [key, page] of Object.entries(report.pages)) console.log(key.padEnd(20), `axe=${page.axe}`.padEnd(8), `LCP=${page.lcpMs}ms`.padEnd(12), `CLS=${page.cls}`);
}
