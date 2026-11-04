import { readFile } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

let script: string;
let css: string;

test.beforeAll(async () => {
  const root = process.cwd();
  const bundle = await build({
    stdin: {
      resolveDir: root, loader: "tsx", sourcefile: "whatsapp-picker-fixture.tsx",
      contents: `
        import { useState } from "react";
        import { createRoot } from "react-dom/client";
        import { WhatsAppNumberPicker } from "@/components/whatsapp-number-picker";
        const options = [{ masked: "+91 ••••• 0874", source: "page", choiceId: "a".repeat(64) }];
        function Fixture() {
          const [selected, setSelected] = useState();
          return <main className="mx-auto max-w-xl p-4">
            <div className="flex min-w-0 flex-col gap-1.5">
              <WhatsAppNumberPicker options={options} selected={selected} wanted="+91 ••••• 0874"
                businessUnavailable onChoose={setSelected} />
              <output data-testid="choice">{selected ? JSON.stringify(selected) : "unchanged"}</output>
            </div>
          </main>;
        }
        createRoot(document.getElementById("root")).render(<Fixture />);
      `,
    },
    alias: { "@": path.join(root, "src") },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  });
  script = bundle.outputFiles[0].text;
  const cssPath = path.join(root, "src/app/globals.css");
  css = (await postcss([tailwind()]).process(await readFile(cssPath, "utf8"), { from: cssPath })).css;
});

for (const width of [320, 390, 1440]) {
  test(`saved WhatsApp choice remains visible and the Page choice is keyboard actionable at ${width}px`, async ({ page }, testInfo) => {
    const unexpected: string[] = [];
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== "http://component.test") { unexpected.push(url.href); return route.abort(); }
      if (url.pathname === "/") return route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html><head><link rel="stylesheet" href="/styles.css"><script defer src="/bundle.js"></script></head><body><div id="root"></div></body></html>',
      });
      if (url.pathname === "/styles.css") return route.fulfill({ contentType: "text/css", body: css });
      if (url.pathname === "/bundle.js") return route.fulfill({ contentType: "text/javascript", body: script });
      if (/^\/node_modules\/@fontsource-variable\/dm-sans\/files\/[\w-]+\.woff2$/.test(url.pathname)) {
        return route.fulfill({ path: path.join(process.cwd(), "node_modules/@fontsource-variable/dm-sans/files", path.basename(url.pathname)), contentType: "font/woff2" });
      }
      unexpected.push(url.href);
      return route.abort();
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("http://component.test/");
    await page.evaluate(() => document.fonts.ready);
    const picker = page.getByLabel("WhatsApp button number");
    await expect(picker).toHaveValue("unavailable:+91 ••••• 0874");
    await expect(picker.locator("option:checked")).toHaveText("+91 ••••• 0874 (previously selected; check this number)");
    await expect(page.getByTestId("choice")).toHaveText("unchanged");
    await expect(page.getByRole("status").filter({ hasText: "WhatsApp Business numbers" })).toContainText("could not be checked");
    const geometry = await picker.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom,
        hit: document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2) === element,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(width);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(900);
    expect(geometry.hit).toBe(true);
    expect(geometry.scrollWidth).toBeLessThanOrEqual(width);
    await page.screenshot({ path: testInfo.outputPath(`before-${width}.png`) });
    const pageChoice = page.getByRole("button", { name: "Use Page number +91 ••••• 0874" });
    const pageChoiceBox = await pageChoice.boundingBox();
    if (!pageChoiceBox) throw new Error("Page choice has no rendered bounds.");
    expect(pageChoiceBox.height).toBeGreaterThanOrEqual(44);
    expect(pageChoiceBox.x).toBeGreaterThanOrEqual(0);
    expect(pageChoiceBox.x + pageChoiceBox.width).toBeLessThanOrEqual(width);
    expect(pageChoiceBox.y + pageChoiceBox.height).toBeLessThanOrEqual(900);
    expect(await pageChoice.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2) === element;
    })).toBe(true);
    await picker.focus();
    await page.keyboard.press("Tab");
    await expect(pageChoice).toBeFocused();
    const focus = await pageChoice.evaluate((element) => ({
      style: getComputedStyle(element).outlineStyle,
      width: parseFloat(getComputedStyle(element).outlineWidth),
    }));
    expect(focus.style).not.toBe("none");
    expect(focus.width).toBeGreaterThanOrEqual(2);
    await page.screenshot({ path: testInfo.outputPath(`focus-${width}.png`) });
    await page.keyboard.press("Enter");
    await expect(picker).toHaveValue("a".repeat(64));
    await expect(page.getByTestId("choice")).toHaveText(JSON.stringify({ masked: "+91 ••••• 0874", source: "page", choiceId: "a".repeat(64) }));
    await page.screenshot({ path: testInfo.outputPath(`after-${width}.png`) });
    await page.reload();
    await pageChoice.click();
    await expect(picker).toHaveValue("a".repeat(64));
    expect(unexpected).toEqual([]);
  });
}
