import assert from "node:assert/strict";
import { mkdir, readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, expect } from "@playwright/test";

// Credential-free, actual components/CSS; transport is blocked, not an authenticated integration check.
const root = fileURLToPath(new URL("../", import.meta.url));
const output = process.argv[2] ?? await mkdtemp(join(tmpdir(), "adbrain-asset-results-"));
await mkdir(output, { recursive: true });
const css = await postcss([tailwind({ base: root })]).process(await readFile(`${root}src/app/globals.css`, "utf8"), { from: `${root}src/app/globals.css` });
const bundle = await build({
  stdin: { contents: `
    import React from "react"; import {createRoot} from "react-dom/client";
    import {MediaLibrary} from "./src/components/media-library";
    import {AssetsLibrary} from "./src/components/assets-library";
    import hi from "./messages/hi.json";
    const image="data:image/svg+xml,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="1080" height="1350" fill="#d3eedd"/><text x="100" y="400" font-size="90">Synthetic photo</text></svg>');
    const totals={destination:"whatsapp",objective:"OUTCOME_ENGAGEMENT",results:3,spendPaise:28800,delivered:true,syncedAt:"2026-11-02T10:00:00Z"};
    const visits={...totals,destination:"website",results:20,spendPaise:10000};
    const result={state:"ready",byMedia:{m1:[totals,visits]},byCreative:{c1:[totals,visits],c2:[{...totals,results:0,spendPaise:0,delivered:false}],c4:[{...totals,results:0}]},unmatched:1,asOf:Date.parse("2026-11-02T10:03:00Z")};
    const words=window.fixture.locale==="hi"?{locale:"hi",messages:hi.verdict}:undefined;
    const creatives=[{id:"c1",headline:"A deliberately long saved ad headline to check small screen wrapping",image_url:image,status:"approved"},{id:"c2",headline:"Not delivered",image_url:image,status:"approved"},{id:"c3",headline:"Unread",image_url:image,status:"draft"},{id:"c4",headline:"Delivered, no chats",image_url:image,status:"approved"}];
    const mount=createRoot(document.getElementById("root"));
    function paint(results){mount.render(<main style={{maxWidth:1160,margin:"24px auto",padding:16}}>
      <h1>Photos</h1><MediaLibrary business={{id:"b1",vertical:null}} media={[{id:"m1",name:"A deliberately long photo name",url:image,tags:[],fit:{message:"Ready for Feed, Stories and Reels"}}]} creatives={creatives} brandAssets={[]} results={results} words={words}/>
      <h1>Assets</h1><AssetsLibrary creatives={creatives} brandAssets={[]} results={results} words={words}/>
    </main>);}
    paint(result);window.showUnavailable=()=>paint({state:"unavailable"});`, resolveDir: root, loader: "tsx" },
  absWorkingDir: root, bundle: true, write: false, outdir: output, format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "no-live-services", setup(builder) {
    builder.onResolve({ filter: /^next\/navigation$|^@\/lib\/supabase\/client$/ }, args => ({ path: args.path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({
      contents: args.path === "next/navigation" ? "export const useRouter=()=>({refresh(){throw Error('Unexpected refresh')}});"
        : "export const createClient=()=>{throw Error('Unexpected database access')};",
      loader: "js", resolveDir: root,
    }));
  } }],
});
const script = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
const browser = await chromium.launch({ channel: "chrome" });
try {
  for (const width of [390, 1440]) for (const locale of ["en", "hi"]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const errors = [];
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await context.route("**/*", route => route.request().url() === "http://asset-results.test/"
      ? route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}</style></head><body><div id="root"></div><script>window.fixture=${JSON.stringify({ locale })};${script}</script></body></html>` })
      : route.abort());
    await page.goto("http://asset-results.test/");
    await expect(page.getByText(locale === "hi" ? /3 चैट/ : /3 chats/)).toHaveCount(3);
    await expect(page.getByText(locale === "hi" ? /20 विज़िट/ : /20 visits/)).toHaveCount(3);
    await expect(page.getByText(locale === "hi" ? /3 मिनट पहले अपडेट हुआ/ : /Updated 3m ago/)).toHaveCount(10);
    await expect(page.getByText(locale === "hi" ? /3 चैट.*₹96/ : /3 chats.*₹96 per chat/)).toHaveCount(3);
    await expect(page.getByText(locale === "hi" ? /0 चैट.*—/ : /0 chats.*— per chat/)).toHaveCount(2);
    await expect(page.getByText(locale === "hi" ? "Meta ने यह विज्ञापन अभी नहीं दिखाया" : "Meta hasn't shown this ad yet")).toHaveCount(2);
    await expect(page.getByText(locale === "hi" ? "अभी कोई नतीजे नहीं" : "No results yet")).toHaveCount(2);
    await page.locator("img").evaluateAll(images => images.forEach(image => { image.loading = "eager"; }));
    await page.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const clipped = await page.locator("p").evaluateAll(elements => elements.filter(element => {
      const bounds = element.getBoundingClientRect();
      return bounds.width && (bounds.left < 0 || bounds.right > innerWidth + 1 || element.scrollWidth > element.clientWidth + 1) && !element.classList.contains("truncate");
    }).map(element => element.textContent));
    assert.deepEqual(clipped, []);
    const controls = page.getByRole("button", { name: /^More for/ });
    await controls.scrollIntoViewIfNeeded();
    await controls.focus();
    await page.keyboard.press("Enter");
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await expect(page.getByRole("textbox", { name: "Name", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.screenshot({ path: `${output}/assets-${locale}-${width}.png`, fullPage: true });
    await page.getByRole("tab", { name: "Made by AdBrain" }).click();
    await expect(controls).toHaveCount(0);
    await page.evaluate(() => window.showUnavailable());
    await expect(page.getByRole("status")).toHaveCount(2);
    await expect(page.getByText(locale === "hi" ? /नतीजे लोड नहीं हो पाए/ : /Results couldn't be loaded/)).toHaveCount(2);
    await expect(page.getByText(locale === "hi" ? /0 चैट/ : /0 chats/)).toHaveCount(0);
    assert.deepEqual(errors, []);
    console.log(`PASS ${locale} ${width}px: separate results/cost/freshness, zero/unread/undelivered/error, no clipping, rename/cancel, tabs; all live transport blocked`);
    await context.close();
  }
} finally {
  await browser.close();
}
console.log(`Screenshots: ${output}`);
