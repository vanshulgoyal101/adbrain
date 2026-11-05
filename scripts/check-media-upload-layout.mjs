import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, webkit, expect } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const cssPath = `${root}src/app/globals.css`;
const css = await postcss([tailwind({ base: root })]).process(await readFile(cssPath, "utf8"), { from: cssPath });
const fontBytes = await readFile(`${root}node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2`);
const font = fontBytes.toString("base64");
const bundle = await build({
  stdin: {
    contents: `import React from "react";
      import { createRoot } from "react-dom/client";
      import { MediaUploadSheet, useMediaUploads } from "./src/components/media-upload";
      import { mediaTranslator } from "./src/i18n/words";
      import en from "./messages/en.json";
      import hi from "./messages/hi.json";

      const attempts = new Map();
      const request = async (input, init) => {
        const url = String(input);
        if (url.startsWith("/api/media?")) return Response.json({
          ok: true, items: [], next: null,
          uploads: { used: 0, limit: 50, videos: { enabled: true, used: 0, limit: 3, maxSeconds: 60, maxBytes: 50 * 1024 * 1024 } },
        });
        if (url !== "/api/media/sign") throw new Error("Unexpected request: " + url);
        const file = JSON.parse(init.body);
        const attempt = (attempts.get(file.name) || 0) + 1;
        attempts.set(file.name, attempt);
        if (attempt === 1) throw new TypeError("fixture offline");
        if (file.mime.startsWith("video/")) return Response.json({
          code: "FIXTURE_ERROR", error: "UnbrokenUploadError" + "x".repeat(90),
        }, { status: 400 });
        return Response.json({ ok: true, duplicate: true, asset: {
          id: "fixture", kind: "image", name: "photo", tags: [], width: 1080, height: 1350,
          bytes: 1, durationMs: null, fit: null, url: null, createdAt: "2026-01-01T00:00:00Z",
        } });
      };
      const deps = { fetch: request, uploadToSignedUrl: async () => { throw new Error("Unexpected Storage write"); } };
      const codec = async (file) => ({ blob: new Blob([file.name], { type: "image/jpeg" }), width: 1080, height: 1350 });
      const videoReader = async () => ({ width: 1080, height: 1920, durationMs: 2000 });
      function Fixture() {
        const locale = document.documentElement.lang;
        const [open, setOpen] = React.useState(true);
        const t = React.useMemo(() => mediaTranslator({ locale, messages: (locale === "hi" ? hi : en).media }), [locale]);
        const uploads = useMediaUploads({ t, businessId: "fixture", onAdded: () => {}, deps, codec, videoReader });
        return <MediaUploadSheet t={t} open={open} onOpenChange={setOpen} uploads={uploads}
          businessId="fixture" vertical={null} consented onConsented={() => {}} videoEnabled />;
      }
      createRoot(document.getElementById("root")).render(<Fixture />);`,
    resolveDir: root,
    loader: "tsx",
  },
  absWorkingDir: root,
  outdir: `${root}test-results/media-upload-bundle`,
  bundle: true,
  write: false,
  format: "iife",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{
    name: "offline-media-boundary",
    setup(plugin) {
      plugin.onResolve({ filter: /^@\/lib\/supabase\/client$/ }, () => ({ path: "client", namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
        contents: 'export function createClient(){throw new Error("Unexpected Supabase client")}',
        loader: "js",
      }));
    },
  }],
});
const script = bundle.outputFiles.find((file) => file.path.endsWith(".js"))?.text;
assert.ok(script, "Upload fixture did not produce JavaScript");

const labels = {
  en: {
    choose: "Choose photos and videos",
    add: "Add 2 files",
    retry: "Try again",
    failed: "This didn't upload. Check your connection and tap Try again.",
    duplicate: "You already added this one; using the saved copy.",
    remove: (name) => `Remove ${name}`,
  },
  hi: {
    choose: "फ़ोटो और वीडियो चुनें",
    add: "2 फ़ाइलें जोड़ें",
    retry: "फिर से कोशिश करें",
    failed: "यह अपलोड नहीं हुआ। इंटरनेट देखें और फिर से कोशिश करें दबाएँ।",
    duplicate: "यह पहले से जुड़ा है; सेव की हुई कॉपी इस्तेमाल होगी।",
    remove: (name) => `${name} हटाएँ`,
  },
};
const photo = "a-very-long-photo-filename-that-must-not-push-the-error-or-buttons-out-of-the-sheet.png";
const video = "a-very-long-video-filename-that-must-not-push-the-error-or-buttons-out-of-the-sheet.mp4";
const longError = `UnbrokenUploadError${"x".repeat(90)}`;
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l1sAAAAASUVORK5CYII=", "base64");
const clip = await readFile(`${root}tests/fixtures/media/tall.mp4`);
const engines = process.argv.includes("--chromium-only") ? [["chromium", chromium]]
  : process.argv.includes("--webkit-only") ? [["webkit", webkit]]
    : [["chromium", chromium], ["webkit", webkit]];
const widths = [320, 360, 390, 480, 1440];
const locales = ["hi", "en"];
let checked = 0;

async function checkMessage(message, context, minimumWidth = 120) {
  const measured = await message.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { width: box.width, height: box.height, lineHeight: parseFloat(style.lineHeight), scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
  });
  assert.ok(measured.width >= minimumWidth, `${context}: message is only ${measured.width}px wide`);
  assert.ok(measured.height <= measured.lineHeight * 6, `${context}: message is ${measured.height}px tall`);
  assert.ok(measured.scrollWidth <= measured.clientWidth + 1, `${context}: message text overflows its column`);
}

async function checkAction(action, row, sheet, context) {
  await action.scrollIntoViewIfNeeded();
  const [target, rowBox, sheetBox] = await Promise.all([action.boundingBox(), row.boundingBox(), sheet.boundingBox()]);
  assert.ok(target && rowBox && sheetBox, `${context}: missing action bounds`);
  assert.ok(target.width >= 44 && target.height >= 44, `${context}: action is smaller than 44px`);
  assert.ok(target.x >= rowBox.x - 1 && target.x + target.width <= rowBox.x + rowBox.width + 1,
    `${context}: action extends outside its row`);
  assert.ok(target.x >= sheetBox.x - 1 && target.x + target.width <= sheetBox.x + sheetBox.width + 1,
    `${context}: action extends outside the sheet`);
  const reachable = await action.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight && element.contains(hit);
  });
  assert.ok(reachable, `${context}: action is off-screen or occluded`);
}

for (const [engineName, engine] of engines) {
  const browser = await engine.launch();
  try {
    for (const width of widths) {
      for (const locale of locales) {
        const context = `${engineName} ${width}px ${locale}`;
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        const errors = [];
        const blocked = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/*", (route) => {
          if (route.request().url() === "http://localhost/") return route.fulfill({
            contentType: "text/html",
            body: `<!doctype html><html lang="${locale}"><head><meta name="viewport" content="width=device-width, initial-scale=1">
              <style>${css.css}\n@font-face{font-family:"DM Sans Variable";font-style:normal;font-weight:100 900;src:url(data:font/woff2;base64,${font}) format("woff2");}</style></head>
              <body><div id="root"></div></body></html>`,
          });
          if (route.request().url() === "http://localhost/node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2") {
            return route.fulfill({ contentType: "font/woff2", body: fontBytes });
          }
          if (route.request().url().startsWith("blob:http://localhost/")) return route.continue();
          blocked.push(route.request().url());
          return route.abort();
        });
        await page.goto("http://localhost/");
        await page.addScriptTag({ content: script });
        await page.evaluate(() => document.fonts.ready);
        const sheet = page.getByRole("dialog");
        await expect(sheet.locator("button").filter({ hasText: labels[locale].choose })).toBeVisible();
        await sheet.locator('input[type="file"]').setInputFiles([
          { name: photo, mimeType: "image/png", buffer: image },
          { name: video, mimeType: "video/mp4", buffer: clip },
        ]);
        const photoRow = sheet.getByRole("listitem").filter({ hasText: photo });
        const videoRow = sheet.getByRole("listitem").filter({ hasText: video });
        await expect(photoRow).toBeVisible();
        await expect(videoRow).toBeVisible();
        const add = sheet.getByRole("button", { name: labels[locale].add });
        await expect(add).toBeEnabled();
        await add.click();
        await expect(photoRow.getByText(labels[locale].failed, { exact: true })).toHaveCount(1);
        await expect(videoRow.getByText(labels[locale].failed, { exact: true })).toHaveCount(1);
        if (process.env.MEDIA_LAYOUT_SCREENSHOT_DIR && width === 320 && locale === "hi") {
          await mkdir(process.env.MEDIA_LAYOUT_SCREENSHOT_DIR, { recursive: true });
          await videoRow.scrollIntoViewIfNeeded();
          await page.screenshot({ path: `${process.env.MEDIA_LAYOUT_SCREENSHOT_DIR}/${engineName}-${width}-${locale}.png` });
        }

        for (const row of [photoRow, videoRow]) {
          await checkMessage(row.getByText(labels[locale].failed, { exact: true }), context);
          await checkAction(row.getByRole("button", { name: labels[locale].retry }), row, sheet, context);
        }
        await checkAction(photoRow.getByRole("button", { name: labels[locale].remove(photo) }), photoRow, sheet, context);
        await checkAction(videoRow.getByRole("button", { name: labels[locale].remove(video) }), videoRow, sheet, context);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false,
          `${context}: document overflows horizontally`);
        const retryPhoto = photoRow.getByRole("button", { name: labels[locale].retry });
        await retryPhoto.focus();
        await page.keyboard.press("Tab");
        await expect(photoRow.getByRole("button", { name: labels[locale].remove(photo) })).toBeFocused();
        await page.keyboard.press("Shift+Tab");
        await expect(retryPhoto).toBeFocused();
        const focusPainted = await retryPhoto.evaluate((element) => {
          const style = getComputedStyle(element);
          return style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2;
        });
        assert.ok(focusPainted, `${context}: retry keyboard focus is not painted`);
        await page.keyboard.press("Enter");
        await expect(photoRow.getByText(labels[locale].duplicate, { exact: true })).toBeVisible();
        await videoRow.getByRole("button", { name: labels[locale].retry }).click();
        const serverMessage = videoRow.getByText(longError, { exact: true });
        await expect(serverMessage).toBeVisible();
        await checkMessage(serverMessage, context);
        await videoRow.getByRole("button", { name: labels[locale].remove(video) }).focus();
        await page.keyboard.press("Space");
        await expect(videoRow).toHaveCount(0);
        assert.deepEqual(errors, [], `${context}: browser errors`);
        assert.deepEqual(blocked, [], `${context}: unexpected network requests`);
        console.log(`${context}: readable failures, reachable actions, retry and remove`);
        checked++;
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
}
assert.equal(checked, engines.length * widths.length * locales.length, "Not all upload layout cases ran");
console.log(`Passed ${checked} upload layout cases`);
