import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
  await page.goto(process.env.MARKETING_CHECK_URL ?? "http://localhost:3000", { waitUntil: "networkidle" });
  const layers = [];
  const examples = [
    { name: "Food & drink", left: 860, top: 30, rotate: -6 },
    { name: "Fitness", left: 1320, top: 160, rotate: 5 },
    { name: "Home services", left: 360, top: 290, rotate: -4 },
  ];
  for (const example of examples) {
    await page.getByRole("radio", { name: example.name, exact: true }).check();
    const poster = page.locator('article[aria-label="Sample ad"] > div').nth(1);
    await poster.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
    const screenshot = await poster.screenshot();
    const input = await sharp(screenshot).resize({ width: 390 }).rotate(example.rotate, { background: "#eef1ef" }).png().toBuffer();
    layers.push({ input, left: example.left, top: example.top });
  }
  await sharp({ create: { width: 1800, height: 900, channels: 3, background: "#eef1ef" } })
    .composite(layers)
    .webp({ quality: 90 })
    .toFile(fileURLToPath(new URL("../public/campaign-preview.webp", import.meta.url)));
  await sharp(fileURLToPath(new URL("../public/campaign-preview.webp", import.meta.url)))
    .extract({ left: 810, top: 0, width: 990, height: 620 })
    .webp({ quality: 90 })
    .toFile(fileURLToPath(new URL("../public/campaign-preview-mobile.webp", import.meta.url)));
  console.log("Generated campaign preview from the three illustrative examples.");
} finally {
  await browser.close();
}