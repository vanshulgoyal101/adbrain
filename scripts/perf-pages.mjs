// Page-load timing in a real browser (#451 perf proof): signed in as the smoke account,
// loads each page N times and prints p50/p90 of TTFB, DOMContentLoaded and load (ms). Read-only.
//   node scripts/perf-pages.mjs [--runs 5] [--pages /dashboard,/campaigns,/brand]
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { localEnv, signInBrowser, testSessionConfig } from "./lib/test-session.mjs";

const origin = "https://adbrain.vanshul.com";
const { values } = parseArgs({ options: { runs: { type: "string", default: "5" }, pages: { type: "string", default: "/dashboard,/campaigns,/brand" } } });
const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1 || runs > 20) throw new Error("--runs must be 1-20.");
const env = await localEnv();
const pct = (list, p) => { const s = [...list].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: "block" });
  // Read-only: block every write. #2574: signed in by a minted session, not the password form (CAPTCHA, #1777).
  await context.route("**/*", (route) => ["GET", "HEAD", "OPTIONS"].includes(route.request().method()) ? route.continue() : route.fulfill({ status: 204, body: "" }));
  await signInBrowser(context, origin, env.SMOKE_EMAIL, { config: testSessionConfig(env, origin) });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  console.log(`page          runs  ttfb p50/p90   dcl p50/p90    load p50/p90  (ms, ${new Date().toISOString().slice(0, 16)}Z)`);
  for (const path of values.pages.split(",")) {
    const samples = [];
    for (let i = 0; i < runs; i++) {
      await page.goto(`${origin}${path}`, { waitUntil: "load" });
      if (new URL(page.url()).pathname.startsWith("/login")) throw new Error("The app sent the minted session to /login.");
      samples.push(await page.evaluate(() => {
        const n = performance.getEntriesByType("navigation")[0];
        return { ttfb: Math.round(n.responseStart), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) };
      }));
    }
    const col = (k) => `${pct(samples.map((s) => s[k]), 0.5)}/${pct(samples.map((s) => s[k]), 0.9)}`.padEnd(15);
    console.log(`${path.padEnd(14)}${String(runs).padEnd(6)}${col("ttfb")}${col("dcl")}${col("load")}`);
  }
} finally {
  await browser.close();
}
