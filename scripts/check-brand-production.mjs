import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { parse } from "node-html-parser";
import sharp from "sharp";

const origin = "https://adbrain.vanshul.com";
const output = fileURLToPath(new URL("../test-results/brand-release/", import.meta.url));
await mkdir(output, { recursive: true });
const paths = markup => parse(markup).querySelectorAll("path").map(path => path.getAttribute("d"));
const expected = paths(await readFile(new URL("../public/logo.svg", import.meta.url), "utf8"));
for (const asset of ["logo.svg", "icon.svg", "favicon.ico", "icon-192.png", "icon-512.png", "apple-icon-180.png", "maskable-512.png"]) {
  const response = await fetch(`${origin}/${asset}?v=brain-1`);
  assert.equal(response.status, 200, asset);
  assert.ok(Buffer.from(await response.arrayBuffer()).equals(await readFile(new URL(`../public/${asset}`, import.meta.url))), `${asset}: deployed bytes differ`);
}
const portfolioIcon = await fetch("https://vanshul.com/images/projects/adbrain-icon.svg");
assert.equal(portfolioIcon.status, 200);
assert.deepEqual(paths(await portfolioIcon.text()), expected);
const socialResponse = await fetch(`${origin}/opengraph-image`);
assert.equal(socialResponse.status, 200);
const social = Buffer.from(await socialResponse.arrayBuffer());
const metadata = await sharp(social).metadata();
assert.equal(metadata.width, 1200);
assert.equal(metadata.height, 630);
await writeFile(`${output}/social.png`, social);

const browser = await chromium.launch();
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    for (const route of ["/", "/login", "/privacy"]) {
      await page.goto(`${origin}${route}`, { waitUntil: "networkidle" });
      assert.ok((await page.title()).includes("AdBrain"));
      assert.ok(await page.locator('link[rel="icon"][href*="brain-1"]').count());
      const mark = page.locator("svg.lucide-brain").first();
      assert.deepEqual(await mark.locator("path").evaluateAll(elements => elements.map(element => element.getAttribute("d"))), expected);
    }
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.screenshot({ path: `${output}/adbrain-${width}.png` });
    await page.goto("https://links.vanshul.com", { waitUntil: "networkidle" });
    const card = page.locator('[data-project="adbrain"]');
    assert.deepEqual(paths(await card.innerHTML()), expected);
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/links-${width}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.goto("https://vanshul.com/#projects", { waitUntil: "networkidle" });
    const title = page.getByRole("heading", { name: "AdBrain", exact: true });
    await title.waitFor();
    await title.scrollIntoViewIfNeeded();
    const image = title.locator("img");
    await image.waitFor();
    assert.equal(await image.evaluate(element => element.complete && element.naturalWidth > 0), true);
    const preview = page.getByRole("img", { name: "AdBrain", exact: true });
    const previewResponse = await page.request.get(new URL(await preview.getAttribute("src"), page.url()).href);
    assert.equal(previewResponse.status(), 200);
    assert.ok((await previewResponse.body()).equals(await readFile(new URL("../../vanshul-portfolio/public/images/projects/adbrain.webp", import.meta.url))), "Portfolio displayed preview differs from the release capture");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `${output}/portfolio-${width}.png` });
    await page.close();
    console.log(`${width}px: AdBrain tabs and brand surfaces, Links mark, Portfolio title mark PASS`);
  }
} finally {
  await browser.close();
}
console.log("Production icon bytes and social raster dimensions: PASS");