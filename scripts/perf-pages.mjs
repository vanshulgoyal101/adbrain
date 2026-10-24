// Page-load timing in a real browser (#451 perf proof): signed in as the smoke account,
// loads each page N times and prints p50/p90 of TTFB, DOMContentLoaded and load (ms). Read-only.
//   node scripts/perf-pages.mjs [--runs 5] [--pages /dashboard,/campaigns,/brand]
import { readFile } from "node:fs/promises";
import { parseArgs, parseEnv } from "node:util";
import { chromium } from "@playwright/test";

const origin = "https://adbrain.vanshul.com";
const { values } = parseArgs({ options: { runs: { type: "string", default: "5" }, pages: { type: "string", default: "/dashboard,/campaigns,/brand" } } });
const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1 || runs > 20) throw new Error("--runs must be 1-20.");
const { SMOKE_EMAIL: email, SMOKE_PASSWORD: password } = process.env.SMOKE_EMAIL
  ? process.env : parseEnv(await readFile("/Users/vanshulgoyal/Development/copilot/adbrain/.env.smoke", "utf8"));
const pct = (list, p) => { const s = [...list].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; };

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: "block" });
  // Read-only: block every write except the sign-in itself.
  await context.route("**/*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const signIn = url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password";
    return ["GET", "HEAD", "OPTIONS"].includes(request.method()) || signIn ? route.continue() : route.fulfill({ status: 204, body: "" });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  await page.goto(`${origin}/login`);
  const pw = page.getByLabel("Password", { exact: true });
  await page.getByLabel("Email", { exact: true }).waitFor();
  for (let i = 0; i < 5 && !(await pw.isVisible()); i++) {
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await pw.waitFor({ timeout: 3_000 }).catch(() => {});
  }
  await page.getByLabel("Email", { exact: true }).fill(email);
  await pw.fill(password);
  await page.getByRole("button", { name: "Sign in with password", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
  console.log(`page          runs  ttfb p50/p90   dcl p50/p90    load p50/p90  (ms, ${new Date().toISOString().slice(0, 16)}Z)`);
  for (const path of values.pages.split(",")) {
    const samples = [];
    for (let i = 0; i < runs; i++) {
      await page.goto(`${origin}${path}`, { waitUntil: "load" });
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
