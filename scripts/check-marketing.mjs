import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const baseURL = process.env.MARKETING_CHECK_URL ?? "http://localhost:3000";
const output = fileURLToPath(new URL("../test-results/marketing/", import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [1440, 1024, 768, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(baseURL, { waitUntil: "networkidle" });
    assert.equal(await page.evaluate(() => innerWidth), width);
    assert.match(await page.title(), /Customer-focused marketing/);
    await page.screenshot({ path: `${output}/${width}-hero.png` });
    const nextSection = await page.locator("#example").boundingBox();
    assert.ok(nextSection.y < (width === 390 ? 844 : 900), "Next section should enter the first viewport");
    for (const industry of ["Food & drink", "Fitness", "Home services"]) {
      await page.getByRole("radio", { name: industry, exact: true }).check();
      await page.getByRole("article", { name: "Sample ad" }).scrollIntoViewIfNeeded();
      await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
      const layout = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        clipped: [...document.querySelectorAll("h1,h2,h3,p,a,legend,label")].filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.textContent),
      }));
      assert.equal(layout.overflow, false, `Horizontal overflow at ${width}`);
      assert.deepEqual(layout.clipped, [], `Clipped text at ${width}`);
    }
    await page.getByRole("radio", { name: "Food & drink", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.getByRole("radio", { name: "Fitness", exact: true }).isChecked(), true);
    await page.getByText("When does a campaign start spending?", { exact: true }).click();
    assert.equal(await page.locator("details[open]").count(), 1);
    await page.screenshot({ path: `${output}/${width}-full.png`, fullPage: true });
    assert.deepEqual(errors, [], "Browser runtime errors");
    console.log(`${width}px: loaded images, no overflow/clipping, example switching, keyboard, FAQ PASS`);
    await context.close();
  }
} finally {
  await browser.close();
}