import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, webkit, expect } from "@playwright/test";
import sharp from "sharp";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = fileURLToPath(new URL("../test-results/scroll-layout/", import.meta.url));
await mkdir(output, { recursive: true });
const cssPath = `${root}src/app/globals.css`;
const css = await postcss([tailwind({ base: root })]).process(await readFile(cssPath, "utf8"), { from: cssPath });
const font = (await readFile(`${root}node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2`)).toString("base64");
const bundle = await build({
  stdin: {
    contents: `import React from "react"; import {createRoot} from "react-dom/client";
      import {AdAssistant} from "./src/components/ad-assistant";
      import {Textarea} from "./src/components/ui/input";
      createRoot(document.getElementById("root")).render(<main style={{maxWidth:720,margin:"24px auto",padding:16}}>
        <AdAssistant business={{id:"scroll-fixture",name:"Solar installer",locations:["Jaipur"],offers:[]}}/>
        <section aria-label="Textarea fixtures" style={{marginTop:24}}>
          {[2,3,7].map(rows => <Textarea key={rows} aria-label={"Rows "+rows} rows={rows} className="mt-1 rounded-md p-2"/>)}
        </section>
      </main>);`,
    resolveDir: root, loader: "tsx",
  },
  absWorkingDir: root, bundle: true, write: false, format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "offline-boundaries", setup(builder) {
    builder.onResolve({ filter: /studio\/actions$/ }, () => ({ path: "actions", namespace: "fixture" }));
    builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: args.path === "actions"
      ? 'export async function setCreativeStatus(){throw new Error("Unexpected write")}'
      : 'import React from "react"; export default function Link(props){return React.createElement("a",props)}', resolveDir: root, loader: "js" }));
  } }],
});

async function scrollbarPixels(image) {
  const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let thumb = 0;
  let track = 0;
  for (let row = 0; row < info.height; row++) {
    for (let column = Math.max(0, info.width - 14); column < info.width; column++) {
      const offset = (row * info.width + column) * info.channels;
      if (data[offset] === 154 && data[offset + 1] === 163 && data[offset + 2] === 173) thumb++;
      if (data[offset] === 241 && data[offset + 1] === 243 && data[offset + 2] === 245) track++;
    }
  }
  return { thumb, track };
}

async function checkTextarea(page, field, name) {
  const dimensions = () => field.evaluate(node => ({ width: node.clientWidth, height: node.clientHeight,
    overflow: getComputedStyle(node).overflowY, gutter: getComputedStyle(node).scrollbarGutter,
    resize: getComputedStyle(node).resize }));
  const empty = await dimensions();
  assert.equal(empty.overflow, "scroll");
  assert.equal(empty.gutter, "stable");
  assert.equal(empty.resize, "vertical");
  const rows = Number(await field.getAttribute("rows"));
  for (const lines of [rows - 1, rows, rows + 1, rows, rows - 1, rows + 1]) {
    await field.fill(Array.from({ length: lines }, (_, index) => `Line ${index}`).join("\n"));
    assert.deepEqual(await dimensions(), empty, `${name}: overflow changed geometry`);
  }
  await field.fill(Array.from({ length: 32 }, (_, index) => `Line ${index}`).join("\n"));
  const before = await scrollbarPixels(await field.screenshot());
  await page.mouse.move(0, 0);
  await page.evaluate(() => new Promise(resolve => {
    const start = performance.now();
    function frame(now) {
      if (now - start > 1600) resolve();
      else requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }));
  const after = await scrollbarPixels(await field.screenshot({ path: `${output}/${name}-scrollbar.png` }));
  assert.ok(before.thumb > 0 && before.track > 0, `${name}: missing painted scrollbar`);
  assert.deepEqual(after, before, `${name}: scrollbar faded after idle`);
  await field.evaluate(node => { node.focus(); node.setSelectionRange(0, 0); node.scrollTop = 0; });
  for (let move = 0; move < 35; move++) await field.press("ArrowDown");
  await expect.poll(() => field.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  await field.fill("Short prompt");
  assert.deepEqual(await dimensions(), empty);
  assert.ok((await scrollbarPixels(await field.screenshot())).track > 0, `${name}: empty track disappeared`);
  const bounds = await field.boundingBox();
  await page.mouse.move(bounds.x + bounds.width - 4, bounds.y + bounds.height - 4);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width + 40, bounds.y + bounds.height + 66, { steps: 8 });
  await page.mouse.up();
  const resized = await dimensions();
  assert.ok(resized.height > empty.height + 30, `${name}: native resize failed`);
  assert.equal(resized.width, empty.width, `${name}: horizontal resize escaped its container`);
}

for (const [engineName, engine] of [["chromium", chromium], ["webkit", webkit]]) {
  const browser = await engine.launch(engineName === "chromium" ? { ignoreDefaultArgs: ["--hide-scrollbars"] } : {});
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = [];
      let pending;
      page.on("pageerror", error => errors.push(error.message));
      await page.route("**/*", route => {
        const url = route.request().url();
        if (url === "http://scroll-fixture.test/") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><div id="root"></div></body></html>' });
        if (url === "http://scroll-fixture.test/api/creatives/assistant") { pending = route; return; }
        return route.abort();
      });
      await page.goto("http://scroll-fixture.test/");
      await page.addStyleTag({ content: css.css + `\n@font-face{font-family:"DM Sans Variable";font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64,${font}) format("woff2");}` });
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const prompt = page.getByRole("textbox", { name: "Campaign goal" });
      await prompt.waitFor();
      await page.evaluate(() => document.fonts.ready);
      await checkTextarea(page, prompt, `${engineName}-${width}-goal`);
      for (const rows of [2, 3, 7]) {
        await checkTextarea(page, page.getByRole("textbox", { name: `Rows ${rows}` }), `${engineName}-${width}-rows${rows}`);
      }
      await page.screenshot({ path: `${output}/${engineName}-${width}-fields.png`, fullPage: true });
      await prompt.fill("Introduce our team");
      await page.getByRole("button", { name: "Start creating" }).click();
      const history = page.getByRole("region", { name: "Conversation history" });
      const bottomGap = () => history.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop);
      async function respond(index) {
        await expect.poll(() => Boolean(pending)).toBe(true);
        const route = pending;
        pending = undefined;
        await route.fulfill({ json: { ready: false, question: { id: `question-${index}`, field: "visual",
          question: `Question ${index}: ${"Describe the service setting and the customers visiting your business. ".repeat(60)}`,
          options: [`Continue ${index}`] } } });
        await expect(page.getByRole("button", { name: `Continue ${index}`, exact: true })).toBeVisible();
      }
      await respond(1);
      await expect.poll(bottomGap).toBeLessThanOrEqual(1);
      await page.getByRole("button", { name: "Continue 1", exact: true }).click();
      await expect.poll(() => Boolean(pending)).toBe(true);
      await history.evaluate(node => { node.scrollTop = 0; });
      await expect.poll(() => history.evaluate(node => node.scrollTop)).toBe(0);
      assert.ok(await bottomGap() > 100, "Pending history must already overflow");
      await history.evaluate(node => new Promise(resolve => {
        node.focus({ preventScroll: true });
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }));
      await respond(2);
      await expect.poll(() => history.evaluate(node => node.scrollTop)).toBe(0);
      assert.ok(await bottomGap() > 100, "History fixture must overflow");
      await history.evaluate(node => { node.scrollTop = node.scrollHeight; });
      await expect.poll(bottomGap).toBeLessThanOrEqual(1);
      await page.getByRole("button", { name: "Continue 2", exact: true }).click();
      await respond(3);
      await expect.poll(bottomGap).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `${output}/${engineName}-${width}-conversation.png`, fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      console.log(`${engineName} ${width}px: textarea geometry, painted scrollbars, keyboard, resize and reader position passed`);
      await page.close();
    }
  } finally { await browser.close(); }
}