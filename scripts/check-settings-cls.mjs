import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, webkit, expect } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const cssPath = `${root}src/app/globals.css`;
const css = await postcss([tailwind({ base: root })]).process(await readFile(cssPath, "utf8"), { from: cssPath });
const font = (await readFile(`${root}node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2`)).toString("base64");
const mutate = process.argv.includes("--remove-marker");
const bundle = await build({
  stdin: {
    contents: `import React from "react";
      import { createRoot } from "react-dom/client";
      import { SettingsColumns, SettingsLoading } from "./src/app/(app)/settings/settings-layout";
      const root = createRoot(document.getElementById("root"));
      window.showSettings = (stage, shape) => {
        const heights = shape === "full" ? [120, 130, 602] : [80, 100, 72];
        const primary = stage === "outer" ? <SettingsLoading label="Meta" primary={${!mutate}} /> : <>
          <section id="meta-panel" style={{height: heights[0]}}>Meta connection</section>
          {stage === "nested"
            ? <SettingsLoading label="WhatsApp" primary={${!mutate}} />
            : <section id="whatsapp" style={{height: heights[1]}}>WhatsApp status</section>}
          <section id="billing" style={{height: heights[2]}}>Billing</section>
        </>;
        root.render(<SettingsColumns primary={primary} secondary={
          <section id="spend" style={{height: 329}}>
            Spend guardrails <button type="button" onClick={() => document.body.dataset.saved = "yes"}>Save</button>
          </section>
        } />);
      };
      window.showSettings("outer", "full");`,
    resolveDir: root,
    loader: "tsx",
  },
  absWorkingDir: root,
  outdir: `${root}test-results/settings-cls-bundle`,
  bundle: true,
  write: false,
  format: "iife",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
});
const script = bundle.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
const moduleCss = bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text;
assert.ok(script && moduleCss, "Settings fixture did not produce JavaScript and CSS");

const afterPaint = (page) => page.evaluate(() =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const engines = process.argv.includes("--chromium-only") ? [["chromium", chromium]]
  : process.argv.includes("--webkit-only") ? [["webkit", webkit]]
    : [["chromium", chromium], ["webkit", webkit]];

for (const [engineName, engine] of process.argv.includes("--streaming-only") ? [] : engines) {
  const browser = await engine.launch();
  try {
    for (const width of [360, 390, 1279, 1280, 1440]) {
      for (const shape of ["full", "short"]) {
        const page = await browser.newPage({ viewport: { width, height: 800 } });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.addInitScript(() => {
          window.settingsShifts = [];
          window.supportsLayoutShift = PerformanceObserver.supportedEntryTypes.includes("layout-shift");
          if (window.supportsLayoutShift) {
            new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.settingsShifts.push(entry.value);
            }).observe({ type: "layout-shift", buffered: true });
          }
        });
        await page.route("**/*", (route) => {
          if (route.request().url() !== "http://settings-fixture.test/") return route.abort();
          return route.fulfill({ contentType: "text/html", body: `<!doctype html>
            <html><head><meta name="viewport" content="width=device-width, initial-scale=1">
            <style>${css.css}\n${moduleCss}\n@font-face{font-family:"DM Sans Variable";font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64,${font}) format("woff2");}</style></head>
            <body><main style="max-width:1152px;margin:auto;padding:0 16px"><header style="height:180px">Settings</header><div id="root"></div></main></body></html>` });
        });
        await page.goto("http://settings-fixture.test/");
        await page.addScriptTag({ content: script });
        const spend = page.locator("#spend");
        const billing = page.locator("#billing");
        await expect(page.getByRole("status", { name: "Loading Meta" })).toBeVisible();
        if (width < 1280) await expect(spend).toBeHidden();
        else await expect(spend).toBeVisible();
        const initialSpend = await spend.boundingBox();
        await afterPaint(page);
        await page.evaluate(() => { window.settingsShifts = []; });

        await page.evaluate((shape) => window.showSettings("nested", shape), shape);
        await expect(page.getByRole("status", { name: "Loading WhatsApp" })).toBeVisible();
        await expect(billing).toBeHidden();
        if (width < 1280) await expect(spend).toBeHidden();
        else await expect(spend).toBeVisible();
        await afterPaint(page);

        await page.evaluate((shape) => window.showSettings("settled", shape), shape);
        await expect(page.locator("#whatsapp")).toBeVisible();
        await expect(billing).toBeVisible();
        await expect(spend).toBeVisible();
        await afterPaint(page);
        const measured = await page.evaluate(() => ({
          width: innerWidth,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          cls: window.supportsLayoutShift ? window.settingsShifts.reduce((sum, value) => sum + value, 0) : null,
        }));
        const finalSpend = await spend.boundingBox();
        const finalBilling = await billing.boundingBox();
        assert.equal(measured.width, width, `${engineName} ${width}px: unexpected viewport`);
        assert.ok(measured.overflow <= 0, `${engineName} ${width}px: horizontal overflow`);
        if (measured.cls !== null) assert.ok(measured.cls <= 0.01, `${engineName} ${width}px ${shape}: CLS ${measured.cls}`);
        assert.ok(finalSpend && finalBilling, `${engineName} ${width}px: missing settings geometry`);
        if (initialSpend) assert.ok(Math.abs(finalSpend.y - initialSpend.y) <= 1, `${engineName} ${width}px: desktop Spend moved`);
        else assert.ok(finalSpend.y >= finalBilling.y + finalBilling.height, `${engineName} ${width}px: settings overlap`);
        assert.deepEqual(errors, [], `${engineName} ${width}px: browser errors`);
        await spend.getByRole("button", { name: "Save" }).click();
        await expect(page.locator("body")).toHaveAttribute("data-saved", "yes");
        console.log(`${engineName} ${width}px ${shape}: ${measured.cls === null ? "CLS unavailable; geometry checked" : `CLS ${measured.cls.toFixed(3)}`}`);
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
}

const require = createRequire(import.meta.url);
const serverBundle = await build({
  stdin: {
    contents: `import React, { Suspense, use } from "react";
      import { renderToPipeableStream } from "react-dom/server";
      import { SettingsColumns, SettingsLoading } from "./src/app/(app)/settings/settings-layout";
      function Pending({ promise, children }) {
        use(promise);
        return children;
      }
      export function createSettingsStream(shape, onShellReady, onError) {
        const resolve = {};
        const pending = Object.fromEntries(["outer", "checklist", "whatsapp", "spend"].map((name) =>
          [name, new Promise((done) => { resolve[name] = done; })]));
        const heights = shape === "full" ? [120, 130, 602] : [80, 100, 72];
        const failed = shape === "error";
        const stream = renderToPipeableStream(<SettingsColumns
          primary={<Suspense fallback={<SettingsLoading label="Meta" primary={${!mutate}} />}>
            <Pending promise={pending.outer}>
              <section id="meta-panel" role={failed ? "alert" : undefined} style={{height: heights[0]}}>
                {failed ? "Meta unavailable" : "Meta connection"}
              </section>
              {!failed && <Suspense fallback={<SettingsLoading label="Checklist" primary={${!mutate}} />}>
                <Pending promise={pending.checklist}><section id="checklist" style={{height: 80}}>Setup checklist</section></Pending>
              </Suspense>}
              <Suspense fallback={<SettingsLoading label="WhatsApp" primary={${!mutate}} />}>
                <Pending promise={pending.whatsapp}>
                  <section id="whatsapp" style={{height: heights[1]}}>
                    {failed ? "WhatsApp unavailable" : "WhatsApp status"}
                  </section>
                </Pending>
              </Suspense>
              <section id="billing" style={{height: heights[2]}}>Billing</section>
            </Pending>
          </Suspense>}
          secondary={<Suspense fallback={<SettingsLoading label="Spend" tall />}>
            <Pending promise={pending.spend}>
              <section id="spend" style={{height: 329}}>
                Spend guardrails <button type="button">Save</button>
              </section>
            </Pending>
          </Suspense>}
        />, { onShellReady: () => onShellReady(stream), onError });
        return { resolve, abort: () => stream.abort() };
      }`,
    resolveDir: root,
    loader: "tsx",
  },
  absWorkingDir: root,
  outdir: `${root}test-results/settings-streaming-bundle`,
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  jsx: "automatic",
  plugins: [{
    name: "node-dependencies",
    setup(plugin) {
      plugin.onResolve({ filter: /^(react(?:\/jsx-runtime)?|react-dom\/server)$/ }, (args) => ({
        path: pathToFileURL(require.resolve(args.path)).href,
        external: true,
      }));
    },
  }],
});
const serverScript = serverBundle.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
const serverCss = serverBundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text;
assert.ok(serverScript && serverCss, "Settings streaming fixture did not produce JavaScript and CSS");
const { createSettingsStream } = await import(`data:text/javascript;base64,${Buffer.from(serverScript).toString("base64")}`);
const fixtures = new Map();
const streamErrors = [];
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname !== "/") {
    response.writeHead(404).end();
    return;
  }
  const id = url.searchParams.get("id");
  const shape = url.searchParams.get("shape");
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.write(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>${css.css}\n${serverCss}\n@font-face{font-family:"DM Sans Variable";font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64,${font}) format("woff2");}</style></head>
    <body><main style="max-width:1152px;margin:auto;padding:0 16px"><header style="height:180px">Settings</header><div id="root">`);
  const fixture = createSettingsStream(shape, (stream) => stream.pipe(response), (error) => {
    streamErrors.push(error.message);
  });
  fixtures.set(id, fixture);
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
try {
  const address = server.address();
  assert.ok(address && typeof address !== "string", "Settings streaming fixture did not start");
  for (const [engineName, engine] of engines) {
    const browser = await engine.launch();
    try {
      for (const width of [360, 390, 1440]) {
        for (const shape of ["full", "short", "error"]) {
          const id = `${engineName}-${width}-${shape}`;
          const page = await browser.newPage({ viewport: { width, height: 800 } });
          const errors = [];
          page.on("pageerror", (error) => errors.push(error.message));
          await page.addInitScript(() => {
            window.settingsShifts = [];
            window.supportsLayoutShift = PerformanceObserver.supportedEntryTypes.includes("layout-shift");
            if (window.supportsLayoutShift) {
              new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.settingsShifts.push(entry.value);
              }).observe({ type: "layout-shift", buffered: true });
            }
          });
          await page.goto(`http://127.0.0.1:${address.port}/?id=${id}&shape=${shape}`, { waitUntil: "commit" });
          await expect(page.getByRole("status", { name: "Loading Meta" })).toBeVisible();
          const fixture = fixtures.get(id);
          assert.ok(fixture, `${id}: missing streaming fixture`);
          fixture.resolve.spend();
          const spend = page.locator("#spend");
          const billing = page.locator("#billing");
          let initialSpend = null;
          if (engineName === "webkit") {
            // Headless WebKit does not deliver React's frame-scheduled updates until this response ends.
            fixture.resolve.outer();
            fixture.resolve.checklist();
            fixture.resolve.whatsapp();
            await page.waitForLoadState("domcontentloaded");
          } else {
            await expect(spend).toHaveCount(1);
            await page.waitForFunction(() => {
              const element = document.querySelector("#spend");
              return element && !element.closest("[hidden]");
            });
            if (width < 1280) await expect(spend).toBeHidden();
            else await expect(spend).toBeVisible();
            initialSpend = await spend.boundingBox();
            await afterPaint(page);
            await page.evaluate(() => { window.settingsShifts = []; });

            fixture.resolve.outer();
            await expect(page.locator("#meta-panel")).toBeVisible();
            await expect(billing).toHaveCount(1);
            await expect(billing).toBeHidden();
            if (width < 1280) await expect(spend).toBeHidden();
            else await expect(spend).toBeVisible();
            if (shape !== "error") {
              await expect(page.getByRole("status", { name: "Loading Checklist" })).toBeVisible();
              const whatsappLoading = page.locator('[data-settings-primary-loading][aria-label="Loading WhatsApp"]');
              await expect(whatsappLoading).toHaveCount(1);
              await expect(whatsappLoading).toBeHidden();
              await afterPaint(page);
              fixture.resolve.checklist();
            }
            await expect(page.getByRole("status", { name: "Loading WhatsApp" })).toBeVisible();
            await expect(billing).toBeHidden();
            await afterPaint(page);
            fixture.resolve.whatsapp();
          }
          await expect(page.locator("#whatsapp")).toBeVisible();
          await expect(billing).toBeVisible();
          await expect(spend).toBeVisible();
          await page.waitForLoadState("domcontentloaded");
          await afterPaint(page);
          const measured = await page.evaluate(() => ({
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            cls: window.supportsLayoutShift ? window.settingsShifts.reduce((sum, value) => sum + value, 0) : null,
          }));
          const finalSpend = await spend.boundingBox();
          const finalBilling = await billing.boundingBox();
          assert.ok(measured.overflow <= 0, `${id}: horizontal overflow`);
          if (measured.cls !== null) assert.ok(measured.cls <= 0.01, `${id}: CLS ${measured.cls}`);
          assert.ok(finalSpend && finalBilling, `${id}: missing settings geometry`);
          if (initialSpend) assert.ok(Math.abs(finalSpend.y - initialSpend.y) <= 1, `${id}: desktop Spend moved`);
          else if (width < 1280) assert.ok(finalSpend.y >= finalBilling.y + finalBilling.height, `${id}: settings overlap`);
          else assert.ok(finalSpend.x >= finalBilling.x + finalBilling.width, `${id}: columns overlap`);
          assert.deepEqual(errors, [], `${id}: browser errors`);
          await page.evaluate(() => {
            document.querySelector("#spend button").addEventListener("click", () => { document.body.dataset.saved = "yes"; });
          });
          await spend.getByRole("button", { name: "Save" }).click();
          await expect(page.locator("body")).toHaveAttribute("data-saved", "yes");
          console.log(`${id} streamed: ${measured.cls === null ? "final geometry checked; intermediate frames unavailable" : `CLS ${measured.cls.toFixed(3)}`}`);
          await page.close();
          fixtures.delete(id);
        }
      }
    } finally {
      await browser.close();
    }
  }
  assert.deepEqual(streamErrors, [], "Settings streaming errors");
} finally {
  for (const fixture of fixtures.values()) fixture.abort();
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
