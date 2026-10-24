import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { chromium } from "@playwright/test";

const origin = "https://adbrain.vanshul.com";
const { SMOKE_EMAIL: email, SMOKE_PASSWORD: password } = parseEnv(await readFile("/Users/vanshulgoyal/Development/copilot/adbrain/.env.smoke", "utf8"));
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  context.setDefaultTimeout(30_000);
  const page = await context.newPage();
  // Read-only: no campaign sync, drafts, prepare or Meta calls from this walk.
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET" && !path.startsWith("/auth/")) return route.abort("blockedbyclient");
    return route.continue();
  });
  await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email", { exact: true }).waitFor();
  if (!(await page.getByLabel("Password", { exact: true }).isVisible())) await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in with password", exact: true }).click();
  await page.waitForURL((url) => url.origin === origin && !url.pathname.startsWith("/login"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/campaigns`);
  const open = page.getByRole("button", { name: "New campaign" });
  await open.waitFor();
  await open.click();
  await page.waitForTimeout(1500);
  const manual = page.getByRole("button", { name: /Choose settings/i });
  if (await manual.isVisible().catch(() => false)) await manual.click();
  await page.waitForTimeout(2000);
  console.log(JSON.stringify(await page.evaluate(() => [...document.querySelectorAll("#campaign-composer button, #campaign-composer [role=tab], #campaign-composer [role=radio], #campaign-composer input[type=radio]")].filter((el) => el.getBoundingClientRect().height > 0).map((el) => `${el.tagName}:${el.getAttribute("role") ?? ""}:${el.textContent.trim().slice(0, 40)}`).slice(0, 25))));
  await page.getByLabel("Campaign name").waitFor();
  const metrics = await page.evaluate(() => {
    const top = (el) => el ? Math.round(el.getBoundingClientRect().top + window.scrollY) : null;
    const composer = document.getElementById("campaign-composer");
    const label = (text) => [...document.querySelectorAll("label, legend, span")].find((el) => el.textContent?.trim().startsWith(text));
    const toggle = document.querySelector('[aria-controls="campaign-composer"]');
    return {
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      composerTop: top(composer), composerHeight: composer ? Math.round(composer.getBoundingClientRect().height) : null,
      campaignName: top(document.getElementById("name")), dailyBudget: top(label("Daily budget")),
      plannedAreasVisible: Boolean(document.getElementById("planned-areas")), whereShouldAdsShow: top(label("Where should ads show?")),
      closeIcon: toggle?.querySelector("svg")?.getAttribute("class")?.match(/lucide-[a-z-]+/)?.[0] ?? null,
      approvedTiles: document.querySelectorAll('#campaign-composer button[aria-pressed]').length,
    };
  });
  console.log(JSON.stringify(metrics));
} finally {
  await browser.close();
}
