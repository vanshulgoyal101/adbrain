import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, webkit, expect } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const cssPath = `${root}src/app/globals.css`;
const css = await postcss([tailwind({ base: root })]).process(await readFile(cssPath, "utf8"), { from: cssPath });
const font = (await readFile(`${root}node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2`)).toString("base64");
const bundle = await build({
  stdin: {
    contents: `import React from "react";
      import { createRoot } from "react-dom/client";
      import { Studio } from "./src/components/studio";
      const business = { id: "fixture-business", name: "Fixture business" };
      const creatives = Array.from({ length: 40 }, (_, index) => ({
        id: "fixture-" + index, business_id: business.id, headline: "Ad " + index,
        brief: "Fixture brief", primary_text: "Fixture copy", image_url: null,
        status: index < 13 ? "approved" : "draft",
        variant_group: index < 13 ? "approved-batch" : "draft-batch",
      }));
      createRoot(document.getElementById("root")).render(
        <main style={{ maxWidth: 1152, margin: "auto", padding: "16px" }}>
          <Studio business={business} initialCreatives={creatives} />
        </main>);`,
    resolveDir: root,
    loader: "tsx",
  },
  absWorkingDir: root,
  outdir: `${root}test-results/review-controls-bundle`,
  bundle: true,
  write: false,
  format: "iife",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{
    name: "offline-review-boundaries",
    setup(plugin) {
      plugin.onResolve({ filter: /^next\/(navigation|link)$|^@\/lib\/supabase\/client$|studio\/actions$/ },
        (args) => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
        contents: args.path === "next/link"
          ? 'import React from "react"; export default function Link(props){return React.createElement("a",props)}'
          : args.path === "next/navigation"
            ? 'export function useRouter(){return {refresh(){},push(){}}}; export function useSearchParams(){return new URLSearchParams()}; export function usePathname(){return "/studio"}'
            : args.path.endsWith("/client")
              ? 'export function createClient(){throw new Error("Unexpected client request")}'
              : 'export async function setCreativeStatus(){throw new Error("Unexpected write")}; export async function deleteCreative(){throw new Error("Unexpected write")}; export async function updateCreativeCopy(){throw new Error("Unexpected write")}',
        resolveDir: root,
        loader: "js",
      }));
    },
  }],
});
const script = bundle.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
assert.ok(script, "Review fixture did not produce JavaScript");
const engines = process.argv.includes("--chromium-only") ? [["chromium", chromium]] : [["chromium", chromium], ["webkit", webkit]];

for (const [engineName, engine] of engines) {
  const browser = await engine.launch();
  try {
    for (const width of [360, 390, 320, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/*", (route) => route.request().url() === "http://review-fixture.test/"
        ? route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
          <style>${css.css}\n@font-face{font-family:"DM Sans Variable";font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64,${font}) format("woff2");}</style></head>
          <body><div id="root"></div></body></html>` })
        : route.abort());
      await page.goto("http://review-fixture.test/");
      await page.addScriptTag({ content: script });
      await page.evaluate(() => document.fonts.ready);
      const heading = page.getByRole("heading", { name: "Ads (40)" });
      const campaign = page.getByRole("link", { name: "Create campaign (13)" });
      const exportButton = page.getByRole("button", { name: "Export approved (13)" });
      const group = page.getByRole("group", { name: "Ad status" });
      await expect(heading).toBeVisible();
      await expect(campaign).toBeVisible();
      await expect(group.getByRole("radio", { name: "All (40)" })).toBeChecked();

      const headingBox = await heading.boundingBox();
      const campaignBox = await campaign.boundingBox();
      const exportBox = await exportButton.boundingBox();
      const groupBox = await group.boundingBox();
      const labels = await group.locator("label").evaluateAll((elements) => elements.map((element) => {
        const { left, right, top, bottom, width, height } = element.getBoundingClientRect();
        return { left, right, top, bottom, width, height };
      }));
      assert.ok(headingBox && campaignBox && exportBox && groupBox, `${engineName} ${width}px: missing controls`);
      if (width === 360 || width === 390) {
        assert.ok(headingBox.y < campaignBox.y + campaignBox.height && campaignBox.y < headingBox.y + headingBox.height,
          `${engineName} ${width}px: heading and action do not share a row`);
      }
      assert.equal(labels.length, 3, `${engineName} ${width}px: missing filter`);
      assert.ok(labels.every((label) => label.left >= groupBox.x - 1 && label.right <= groupBox.x + groupBox.width + 1),
        `${engineName} ${width}px: a filter is clipped`);
      assert.ok(labels.every((label) => label.width >= 44 && label.height >= 44), `${engineName} ${width}px: a filter target is under 44px`);
      if (width < 640) {
        assert.ok(exportBox.width >= 44 && exportBox.height >= 44 && campaignBox.height >= 44,
          `${engineName} ${width}px: an action target is under 44px`);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false,
        `${engineName} ${width}px: horizontal overflow`);
      for (const target of [campaign, exportButton, ...await group.locator("label").all()]) {
        const reachable = await target.evaluate((element) => {
          const box = element.getBoundingClientRect();
          const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
          return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight && element.contains(hit);
        });
        assert.ok(reachable, `${engineName} ${width}px: a control is off-screen or occluded`);
      }
      const approved = group.getByRole("radio", { name: "Approved (13)" });
      await group.locator("label").filter({ hasText: "Approved" }).click();
      await expect(approved).toBeChecked();
      const all = group.getByRole("radio", { name: "All (40)" });
      await all.focus();
      await page.keyboard.press("Space");
      await expect(all).toBeChecked();
      await approved.focus();
      await page.keyboard.press("Space");
      await expect(approved).toBeChecked();
      const focusRing = await group.locator("label").filter({ hasText: "Approved" }).evaluate((element) => {
        const style = getComputedStyle(element);
        return style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2;
      });
      assert.ok(focusRing, `${engineName} ${width}px: keyboard focus is not painted`);
      await expect(page.getByRole("region", { name: "Ads" }).getByRole("button", { name: "Ad 0 Approved" })).toBeVisible();
      assert.deepEqual(errors, [], `${engineName} ${width}px: browser errors`);
      console.log(`${engineName} ${width}px: controls reachable, pointer/keyboard filters and focus; no overflow`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}
