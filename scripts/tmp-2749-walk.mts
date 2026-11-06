import { chromium } from "playwright";
import { signInBrowser, testSessionConfig } from "./lib/test-session.mjs";
const origin = "https://adbrain.vanshul.com";
const browser = await chromium.launch();
for (const key of ["FRESH_EMAIL", "PROSPECT_WEB_EMAIL"]) {
  for (const lang of ["hi", "en"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route("**/*", (route) => route.request().method() === "GET" ? route.continue() : route.abort());
    await signInBrowser(context, origin, process.env[key]!, { config: testSessionConfig(process.env, origin) });
    await context.addCookies([{ name: "adbrain_lang", value: lang, url: origin }]);
    const page = await context.newPage();
    await page.goto(`${origin}/campaigns`, { waitUntil: "networkidle" });
    const text = await page.locator("main").innerText();
    const line = text.split("\n").find((l) => /Customers see your welcome|स्वागत मैसेज/.test(l)) ?? "(no tap line)";
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    console.log(key, lang, page.url().replace(origin, ""), "|", line, "| overflow:", overflow);
    await page.screenshot({ path: `/tmp/2749-${key}-${lang}.png`, fullPage: true });
    await context.close();
  }
}
await browser.close();
