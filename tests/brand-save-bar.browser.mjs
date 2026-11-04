import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, webkit } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = `${root}test-results/brand-save-bar`;
const label = process.argv[2] ?? "current";
assert.match(label, /^[a-z0-9-]+$/);
const baseline = process.argv.find(arg => arg.startsWith("--baseline="))?.slice("--baseline=".length);
if (baseline) assert.match(baseline, /^[a-f0-9]{7,40}$/);
const baselineSource = baseline
  ? execFileSync("git", ["show", `${baseline}:src/components/brand-form.tsx`], { cwd: root, encoding: "utf8" })
  : null;
await mkdir(output, { recursive: true });

const cssPath = `${root}src/app/globals.css`;
const css = await postcss([tailwind({ base: root })]).process(await readFile(cssPath, "utf8"), { from: cssPath });
const bundle = await build({
  stdin: {
    contents: `
      import React from "react";
      import { createRoot } from "react-dom/client";
      import { BrandForm } from "./src/components/brand-form";
      import { WorkspaceShell } from "./src/components/workspace-shell";
      import { PageHeader } from "./src/components/ui/page-header";

      const business = {
        id: "fixture-business", name: "Fixture Solar", vertical: "Solar installer",
        website: "https://example.test", description: "Solar installations for homes.",
        brand_voice: "", primary_color: "", secondary_color: "", font: "",
        target_audience: "", languages: [], locations: [], usps: [], offers: [],
        logo_url: "", phone: "", email: "", address: ""
      };
      createRoot(document.getElementById("root")).render(
        <WorkspaceShell email="fixture@example.test" ownerId="fixture-owner"
          businessId={null} businessName={business.name}>
          <div>
            <PageHeader title="Your business" description={
              <p>What AdBrain knows about your business. Every ad and campaign uses it.</p>
            } />
            <nav aria-label="Business sections"
              className="mt-5 flex gap-2 overflow-x-auto border-y border-slate-200/80 py-2 pr-10 text-sm [mask-image:linear-gradient(to_right,#000_calc(100%-40px),transparent)] md:pr-0 md:[mask-image:none]">
              {[
                ["Basics", "brand-identity"], ["Contact details", "brand-contact"],
                ["Brand details", "brand-creative"], ["Ad instructions", "brand-guidance"],
                ["Brand assets", "brand-assets"]
              ].map(([text, id]) => <a key={id} href={"#" + id}
                className="flex min-h-11 items-center whitespace-nowrap rounded-lg px-3 font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950">{text}</a>)}
            </nav>
            <div className="mt-6 flex flex-col gap-6">
              <BrandForm business={business} photoCount={0} />
              <section id="brand-guidance" style={{minHeight:640}}>Additional Brand sections</section>
            </div>
          </div>
        </WorkspaceShell>
      );
    `,
    resolveDir: root,
    loader: "tsx",
  },
  absWorkingDir: root,
  outdir: output,
  bundle: true,
  write: false,
  format: "iife",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{
    name: "offline-boundaries",
    setup(builder) {
      if (baselineSource) builder.onLoad({ filter: /\/src\/components\/brand-form\.tsx$/ }, () => ({
        contents: baselineSource, resolveDir: `${root}src/components`, loader: "tsx",
      }));
      builder.onResolve({ filter: /^next\/(link|navigation)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      builder.onResolve({ filter: /^@\/app\/\(app\)\/brand\/actions$/ }, () => ({ path: "save", namespace: "fixture" }));
      builder.onResolve({ filter: /^@\/lib\/supabase\/client$/ }, () => ({ path: "supabase", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({
        resolveDir: root,
        loader: "js",
        contents: {
          "next/link": `import React from "react";
            export default function Link({href,prefetch,...props}) { return React.createElement("a",{href,...props}); }
            export function useLinkStatus() { return {pending:false}; }`,
          "next/navigation": `export function usePathname() { return "/brand"; }
            export function useRouter() { return {push(){},refresh(){}}; }`,
          save: `export async function saveBusiness(previous, data) {
            if (!window.fixtureSaveAllowed) throw new Error("Unexpected save");
            window.fixtureSubmissions.push(Object.fromEntries(data.entries()));
            return await new Promise(resolve => { window.finishFixtureSave = resolve; });
          }`,
          supabase: `export function createClient() { throw new Error("Unexpected Supabase access"); }`,
        }[args.path],
      }));
    },
  }],
});

const script = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
const moduleCss = bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>${css.css}\n${moduleCss}</style></head>
  <body><div id="root"></div><script>window.fixtureSubmissions=[];</script><script>${script}</script></body></html>`;

// Count only intersections actually painted over by the form's Save bar.
async function measurements(page, sweep = false) {
  return page.evaluate(sweep => {
    const form = document.querySelector("form");
    const save = form.querySelector('[data-product-event="brand.save"]');
    const bar = save.parentElement;
    const description = form.querySelector('[name="description"]');
    const fields = [...form.querySelectorAll('input:not([type="hidden"]),textarea,select')];
    function sample() {
      const rect = element => {
        const { x, y, width, height, top, bottom } = element.getBoundingClientRect();
        return { x, y, width, height, top, bottom };
      };
      const barRect = bar.getBoundingClientRect();
      const collisions = [];
      for (const field of fields) {
        const fieldRect = field.getBoundingClientRect();
        const left = Math.max(fieldRect.left, barRect.left, 0);
        const right = Math.min(fieldRect.right, barRect.right, innerWidth);
        const top = Math.max(fieldRect.top, barRect.top, 0);
        const bottom = Math.min(fieldRect.bottom, barRect.bottom, innerHeight);
        if (right <= left || bottom <= top) continue;
        const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
        if (hit && bar.contains(hit)) collisions.push({
          field: field.name || field.getAttribute("aria-label") || field.placeholder,
          height: Math.round((bottom - top) * 10) / 10,
        });
      }
      return {
        viewport: [innerWidth, innerHeight],
        scrollY: Math.round(scrollY),
        description: rect(description),
        bar: rect(bar),
        save: rect(save),
        collisions,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      };
    }
    if (!sweep) return sample();
    const formBottom = form.getBoundingClientRect().bottom + scrollY;
    let worst = { scrollY: 0, collisions: [] };
    let sampledPositions = 0;
    for (let offset = 0; offset < formBottom; offset += 40) {
      window.scrollTo(0, offset);
      const current = sample();
      sampledPositions++;
      if (current.collisions.length && (!worst.collisions.length || current.collisions[0].height > worst.collisions[0].height)) {
        worst = current;
      }
    }
    return { formBottom, worst, sampledPositions };
  }, sweep);
}

async function fullyUnobscured(locator) {
  return locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    if (rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight) return false;
    const insetX = Math.min(8, rect.width / 4);
    const insetY = Math.min(8, rect.height / 4);
    for (const x of [rect.left + insetX, (rect.left + rect.right) / 2, rect.right - insetX]) {
      for (const y of [rect.top + insetY, (rect.top + rect.bottom) / 2, rect.bottom - insetY]) {
        const hit = document.elementFromPoint(x, y);
        if (hit !== element && !element.contains(hit)) return false;
      }
    }
    return true;
  });
}

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };
const cases = [
  { engine: "chromium", browser: chromium, width: 360, height: 800 },
  { engine: "webkit", browser: webkit, width: 390, height: 844 },
  { engine: "chromium", browser: chromium, width: 1440, height: 900 },
];

for (const { engine, browser: browserType, width, height } of cases) {
  const browser = await browserType.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    const unexpected = [];
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.href === "http://brand-fixture.test/") {
        return route.fulfill({ contentType: "text/html", body: html });
      }
      if (url.origin === "http://brand-fixture.test" && /^\/(?:node_modules\/@fontsource-variable\/dm-sans\/)?files\/dm-sans-[\w-]+\.woff2$/.test(url.pathname)) {
        const font = await readFile(`${root}node_modules/@fontsource-variable/dm-sans/files/${basename(url.pathname)}`);
        return route.fulfill({ contentType: "font/woff2", body: font });
      }
      unexpected.push(`${route.request().method()} ${url.href}`);
      return route.abort();
    });
    await page.goto("http://brand-fixture.test/");
    const save = page.getByRole("button", { name: "Save your business", exact: true });
    const description = page.getByRole("textbox", { name: "Description", exact: true });
    const status = page.locator("form [role=status]");
    await description.waitFor();
    await page.evaluate(() => document.fonts.ready);
    check(await status.count() === 1, `${engine} ${width}: status region missing before save`);
    await status.evaluate(node => { window.fixtureStatus = node; });

    const initial = await measurements(page);
    await page.screenshot({ path: `${output}/${label}-${engine}-${width}-initial.png` });
    check(!initial.horizontalOverflow, `${engine} ${width}: horizontal overflow`);
    check(initial.collisions.length === 0, `${engine} ${width}: initial fields covered ${JSON.stringify(initial.collisions)}`);

    const jump = page.getByRole("link", { name: /jump to save/i });
    if (!await fullyUnobscured(save)) {
      check(await jump.count() === 1 && await fullyUnobscured(jump), `${engine} ${width}: no visible Save or jump link initially`);
      if (await jump.count()) {
        await jump.focus();
        await page.keyboard.press("Enter");
        const bar = save.locator("..");
        check(await bar.evaluate(node => node === document.activeElement || node.contains(document.activeElement)),
          `${engine} ${width}: keyboard jump did not focus the Save area`);
        if (!await save.evaluate(node => document.activeElement === node)) await page.keyboard.press("Tab");
        check(await save.evaluate(node => document.activeElement === node), `${engine} ${width}: keyboard jump did not focus Save`);
        check(await fullyUnobscured(save), `${engine} ${width}: Save is obscured after the keyboard jump`);
      }
    }

    const { formBottom, worst, sampledPositions } = await measurements(page, true);
    check(worst.collisions.length === 0, `${engine} ${width}: scrolling covers fields at y=${worst.scrollY}: ${JSON.stringify(worst.collisions)}`);
    await page.evaluate(y => window.scrollTo(0, y), worst.collisions.length ? worst.scrollY : Math.round(formBottom / 3));
    const scrolled = await measurements(page);
    const visibleFields = await page.locator('form input:not([type="hidden"]),form textarea,form select').evaluateAll(nodes =>
      nodes.flatMap(node => {
        const rect = node.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < innerHeight
          ? [{ field: node.name || node.getAttribute("aria-label") || node.placeholder, top: Math.round(rect.top), bottom: Math.round(rect.bottom) }]
          : [];
      }));
    await page.screenshot({ path: `${output}/${label}-${engine}-${width}-scroll.png` });

    await page.locator('input[name="vertical"]').focus();
    await page.keyboard.press("Tab");
    check(await description.evaluate(node => document.activeElement === node), `${engine} ${width}: Tab no longer reaches Description`);
    const focused = await measurements(page);
    const focusedUnobscured = await fullyUnobscured(description);
    check(focusedUnobscured, `${engine} ${width}: focused Description is not fully visible and unobscured`);
    await page.screenshot({ path: `${output}/${label}-${engine}-${width}-focused.png` });

    await page.locator('input[name="name"]').focus();
    const focusedFields = [];
    let reachedSave = false;
    for (let i = 0; i < 50; i++) {
      await page.keyboard.press("Tab");
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      if (await save.evaluate(node => document.activeElement === node)) { reachedSave = true; break; }
      const focusedField = await page.evaluate(() => {
        const node = document.activeElement;
        if (!node?.matches('form input:not([type="hidden"]),form textarea,form select')) return null;
        return node.name || node.getAttribute("aria-label") || node.placeholder;
      });
      if (focusedField) {
        focusedFields.push(focusedField);
        const field = page.locator("form :focus");
        if (!await fullyUnobscured(field)) {
          const detail = await field.evaluate(node => {
            const rect = node.getBoundingClientRect();
            return {
              bounds: [rect.left, rect.top, rect.right, rect.bottom],
              hits: [rect.left + 8, (rect.left + rect.right) / 2, rect.right - 8].flatMap(x =>
                [rect.top + 8, (rect.top + rect.bottom) / 2, rect.bottom - 8].map(y => {
                  const hit = document.elementFromPoint(x, y);
                  return hit === node || node.contains(hit) ? null : `${hit?.tagName}.${hit?.className}`;
                }).filter(Boolean)),
            };
          });
          check(false, `${engine} ${width}: focused ${focusedField} is obscured ${JSON.stringify(detail)}`);
        }
      }
    }
    check(focusedFields.includes("description") && focusedFields.includes("logo_url"), `${engine} ${width}: keyboard traversal missed fields`);
    check(reachedSave && await fullyUnobscured(save), `${engine} ${width}: Save is not keyboard-reachable after the fields`);

    let returnedToName = false;
    for (let i = 0; i < 50; i++) {
      await page.keyboard.press("Shift+Tab");
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const field = page.locator('form :focus:is(input:not([type="hidden"]),textarea,select)');
      if (await field.count()) {
        const name = await field.evaluate(node => node.name || node.getAttribute("aria-label") || node.placeholder);
        if (!await fullyUnobscured(field)) {
          const detail = await field.evaluate(node => {
            const rect = node.getBoundingClientRect();
            const hit = document.elementFromPoint((rect.left + rect.right) / 2, rect.top + 8);
            return { bounds: [rect.left, rect.top, rect.right, rect.bottom], hit: `${hit?.tagName}.${hit?.className}` };
          });
          check(false, `${engine} ${width}: reverse-focused ${name} is obscured ${JSON.stringify(detail)}`);
        }
        if (name === "name") { returnedToName = true; break; }
      }
    }
    check(returnedToName, `${engine} ${width}: reverse keyboard traversal missed the first field`);

    await description.fill("Edited fixture description");
    await page.evaluate(() => { window.fixtureSaveAllowed = true; });
    await save.click();
    await page.waitForFunction(() => typeof window.finishFixtureSave === "function");
    check(await save.isDisabled(), `${engine} ${width}: pending Save is not disabled`);
    await description.fill("Edited while saving");
    if (await jump.count()) {
      await jump.focus();
      await page.keyboard.press("Enter");
      const bar = save.locator("..");
      check(await bar.evaluate(node => node === document.activeElement || node.contains(document.activeElement)),
        `${engine} ${width}: jumping to a pending save loses keyboard focus`);
      check(await fullyUnobscured(bar), `${engine} ${width}: pending Save is obscured after the jump`);
    }
    const errorText = "Your business details weren't saved. Check your connection and try again.";
    await page.evaluate(error => { const finish = window.finishFixtureSave; window.finishFixtureSave = null; finish({ ok: false, error }); }, errorText);
    await status.getByText(errorText).waitFor();
    check(await description.inputValue() === "Edited while saving", `${engine} ${width}: failed save lost the in-flight edit`);
    check(await status.evaluate(node => node === window.fixtureStatus), `${engine} ${width}: status region replaced on failure`);
    await status.scrollIntoViewIfNeeded();
    check(await fullyUnobscured(status), `${engine} ${width}: error status is obscured`);
    await page.screenshot({ path: `${output}/${label}-${engine}-${width}-error.png` });

    await save.click();
    await page.waitForFunction(() => typeof window.finishFixtureSave === "function");
    await page.evaluate(() => { const finish = window.finishFixtureSave; window.finishFixtureSave = null; finish({ ok: true }); });
    await status.getByText("Saved", { exact: true }).waitFor();
    const next = page.getByRole("link", { name: "Next: Create ads" });
    check(await next.count() === 1, `${engine} ${width}: next step missing after save`);
    check(await status.evaluate(node => node === window.fixtureStatus), `${engine} ${width}: status region replaced on success`);
    check(await page.evaluate(() => window.fixtureSubmissions.length === 2
      && window.fixtureSubmissions[0].description === "Edited fixture description"
      && window.fixtureSubmissions[1].description === "Edited while saving"), `${engine} ${width}: save/retry payload changed`);
    await page.screenshot({ path: `${output}/${label}-${engine}-${width}-success.png` });

    // A successful first save must not expand the Next link below the viewport.
    await page.reload();
    await description.waitFor();
    await page.evaluate(() => { window.fixtureSaveAllowed = true; });
    await save.scrollIntoViewIfNeeded();
    await save.evaluate(node => {
      const bounds = node.parentElement.getBoundingClientRect();
      window.scrollBy(0, bounds.bottom - (innerHeight - 4));
    });
    check(await fullyUnobscured(save), `${engine} ${width}: first-save setup did not expose Save`);
    await save.click();
    await page.waitForFunction(() => typeof window.finishFixtureSave === "function");
    await page.evaluate(() => { const finish = window.finishFixtureSave; window.finishFixtureSave = null; finish({ ok: true }); });
    await status.getByText("Saved", { exact: true }).waitFor();
    await next.waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    check(await fullyUnobscured(next), `${engine} ${width}: first-save Next link is outside the viewport`);
    check(await fullyUnobscured(status), `${engine} ${width}: first-save status is outside the viewport`);
    await page.screenshot({ path: `${output}/${label}-${engine}-${width}-first-success.png` });

    await page.reload();
    await description.waitFor();
    await page.evaluate(() => { window.fixtureSaveAllowed = true; });
    await save.scrollIntoViewIfNeeded();
    await save.evaluate(node => {
      const bounds = node.parentElement.getBoundingClientRect();
      window.scrollBy(0, bounds.bottom - (innerHeight - 4));
    });
    await save.click();
    await page.waitForFunction(() => typeof window.finishFixtureSave === "function");
    await page.evaluate(error => { const finish = window.finishFixtureSave; window.finishFixtureSave = null; finish({ ok: false, error }); }, errorText);
    await status.getByText(errorText).waitFor();
    check(await fullyUnobscured(status), `${engine} ${width}: first-save error is outside the viewport`);
    await page.screenshot({ path: `${output}/${label}-${engine}-${width}-first-error.png` });

    await page.reload();
    await description.waitFor();
    await page.evaluate(() => { window.fixtureSaveAllowed = true; });
    await save.click();
    await page.waitForFunction(() => typeof window.finishFixtureSave === "function");
    await description.fill("Edited while the save is pending");
    const scrollBeforeFinish = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => { const finish = window.finishFixtureSave; window.finishFixtureSave = null; finish({ ok: true }); });
    await page.waitForFunction(() => !document.querySelector('[data-product-event="brand.save"]').disabled);
    check(Math.abs(await page.evaluate(() => window.scrollY) - scrollBeforeFinish) < 2,
      `${engine} ${width}: finishing a stale save moved the user away from their edit`);
    check(await description.evaluate(node => document.activeElement === node) && await fullyUnobscured(description),
      `${engine} ${width}: finishing a stale save disturbed the focused field`);
    check(await status.textContent() === "" && await next.count() === 0,
      `${engine} ${width}: a stale save was presented as current`);
    check(errors.length === 0, `${engine} ${width}: page errors ${errors.join("; ")}`);
    check(unexpected.length === 0, `${engine} ${width}: unexpected requests ${unexpected.join("; ")}`);

    console.log(JSON.stringify({
      label, engine, viewport: initial.viewport,
      initial: { description: initial.description, bar: initial.bar, collisions: initial.collisions },
      scroll: { y: scrolled.scrollY, sampledPositions, visibleFields, collisions: worst.collisions },
      focus: { y: focused.scrollY, description: focused.description, bar: focused.bar, unobscured: focusedUnobscured },
      keyboardFields: focusedFields,
      states: "pending, error, retry, success checked with stubbed action",
    }));
    await page.close();
  } finally {
    await browser.close();
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Brand Save bar: responsive layout, focus, keyboard and save states PASS");
}
