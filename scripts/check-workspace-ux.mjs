import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";

if (process.argv.includes("--offline-leads")) {
  await checkOfflineLeads();
} else {
const origin = process.env.WORKSPACE_CHECK_URL ?? "http://localhost:3000";
if (new URL(origin).hostname !== "localhost") throw new Error("Workspace checks are restricted to localhost.");
const output = fileURLToPath(new URL("../test-results/workspace-ux/", import.meta.url));
await mkdir(output, { recursive: true });
let cookies = [];
const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  cookies: { getAll: () => [], setAll: updates => { cookies = updates.map(({ name, value }) => ({ name, value, domain: "localhost", path: "/", sameSite: "Lax" })); } },
});
const { error } = await client.auth.signInWithPassword({ email: process.env.DEV_LOGIN_EMAIL, password: process.env.DEV_LOGIN_PASSWORD });
if (error) throw new Error("Development account sign-in failed.");
const fixtures = [
  { id: "qa-1", full_name: "Asha Verma", phone: "+919876543210", email: "asha@example.com", city: "Bengaluru", form_name: "Consultation enquiry", created_time: "2026-09-06T10:00:00Z" },
  { id: "qa-2", full_name: "Ravi Shah", phone: null, email: "ravi.shah@example.com", city: "Pune", form_name: "Weekend appointment", created_time: "2026-09-05T10:00:00Z" },
  { id: "qa-3", full_name: "Meera Desai", phone: null, email: null, city: "Hyderabad", form_name: "New customer enquiry", created_time: null },
];
const browser = await chromium.launch();
async function capture(page, name) {
  await page.locator("img").evaluateAll(images => images.forEach(image => { image.loading = "eager"; }));
  await page.waitForFunction(() => Array.from(document.images).every(image => image.complete && image.naturalWidth > 0));
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
}
try {
  for (const width of process.env.WORKSPACE_CHECK_WIDTH ? [Number(process.env.WORKSPACE_CHECK_WIDTH)] : [1440, 1024, 768, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    await context.addCookies(cookies);
    await context.route("**/api/**", route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/leads" && route.request().method() === "GET") {
        const query = url.searchParams.get("query")?.toLowerCase() ?? "";
        const contact = url.searchParams.get("contact") ?? "all";
        const leads = fixtures.filter(row => (!query || [row.full_name, row.phone, row.email, row.city, row.form_name].some(value => value?.toLowerCase().includes(query))) &&
          (contact === "all" || Boolean(row.phone || row.email) === (contact === "ready")));
        return route.fulfill({ json: { leads, total: leads.length, nextCursor: null } });
      }
      if (route.request().method() === "GET") return route.continue();
      if (url.pathname === "/api/leads/sync") return route.fulfill({ json: { leads: fixtures, imported: 3, sync: { id: "fixture-sync", state: "complete", hasMore: false } } });
      return route.fulfill({ status: 503, json: { error: "Live operations are disabled during browser validation." } });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    for (const path of ["dashboard", "create", "studio", "brand", "leads", "campaigns", "assets", "settings"]) {
      await page.goto(`${origin}/${path}`, { waitUntil: "networkidle" });
      assert.ok(!page.url().includes("/login"), "Authenticated route unexpectedly redirected");
      assert.equal(await page.evaluate(() => innerWidth), width);
      await page.locator("main h1").waitFor();
      await capture(page, `${path}-${width}`);
      const overflow = await page.locator("main *").evaluateAll(elements => elements.filter(element => element.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map(element => ({ tag: element.tagName, classes: element.className, text: element.textContent?.slice(0, 90) })));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${path}: horizontal overflow at ${width}: ${JSON.stringify(overflow)}`);
      if (path === "campaigns") {
        const search = page.getByRole("searchbox", { name: "Search campaigns" });
        if (await search.count()) {
          await search.fill("qa-no-matching-campaign-8439");
          await page.getByRole("heading", { name: "No matching campaigns" }).waitFor();
          await page.getByRole("button", { name: "Clear filters", exact: true }).click();
          await page.getByRole("combobox", { name: "Campaign status" }).selectOption("paused");
          assert.equal(await search.inputValue(), "");
          await page.getByRole("combobox", { name: "Campaign status" }).selectOption("all");
        }
        const open = page.getByRole("button", { name: "New campaign", exact: true });
        if (await open.count()) {
          assert.equal(await page.locator("#campaign-composer").isVisible(), false);
          await open.click();
          const name = page.getByRole("textbox", { name: "Campaign name", exact: true });
          if (await name.count()) {
            await name.fill("QA draft kept locally");
            await page.getByRole("spinbutton", { name: "Daily budget (₹)", exact: true }).fill("200");
            await page.getByRole("checkbox", { name: /A\/B test the audience/ }).check();
            await page.getByText("₹400/day", { exact: true }).waitFor();
            await page.getByRole("radio", { name: "Plan with AdBrain" }).check();
            assert.equal(await name.isVisible(), false);
            await page.getByRole("button", { name: "Close campaign setup" }).click();
            await open.click();
            assert.equal(await page.getByRole("radio", { name: "Plan with AdBrain" }).isChecked(), true);
            await page.getByRole("radio", { name: "Choose settings" }).check();
            assert.equal(await name.inputValue(), "QA draft kept locally");
          }
          await capture(page, `campaign-composer-${width}`);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Campaign composer overflows at ${width}`);
        }
      }
      if (path === "create") {
        const goal = page.getByRole("textbox", { name: "Campaign goal" });
        await goal.fill("Reach new customers");
        await goal.press("Enter");
        await goal.pressSequentially("in our service areas");
        assert.equal(await goal.inputValue(), "Reach new customers\nin our service areas");
        await page.getByRole("region", { name: "Campaign brief" }).locator("button").filter({ has: page.locator("svg") }).first().click();
        assert.ok((await goal.inputValue()).length > 0);
        assert.ok((await goal.inputValue()).length <= 500);
      }
      if (path === "settings") {
        assert.equal(await page.getByRole("button", { name: "Run traffic generator" }).count(), 0);
      }
      if (path === "leads") {
        const sync = page.getByRole("button", { name: "Sync leads", exact: true });
        if (await sync.count()) {
          await sync.click();
          await page.getByText("Asha Verma", { exact: true }).waitFor();
          await page.getByRole("searchbox", { name: "Search enquiries" }).fill("ravi@");
          await page.getByRole("searchbox", { name: "Search enquiries" }).fill("ravi.shah@");
          await expect(page.getByText("Ravi Shah", { exact: true })).toBeVisible();
          await page.getByRole("button", { name: "Clear filters", exact: true }).click();
          await page.getByRole("combobox", { name: "Contact availability" }).selectOption("missing");
          await expect(page.getByText("Meera Desai", { exact: true })).toBeVisible();
          assert.equal(await page.getByText("Asha Verma", { exact: true }).count(), 0);
          await page.getByRole("button", { name: "Clear filters", exact: true }).click();
          await capture(page, `enquiries-populated-${width}`);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        }
      }
    }
    if (width < 768) {
      await page.getByRole("button", { name: "Open navigation" }).click();
      const dialog = page.getByRole("dialog", { name: "Workspace menu" });
      assert.equal(await dialog.isVisible(), true);
      await page.keyboard.press("Escape");
      assert.equal(await dialog.isVisible(), false);
      assert.equal(await page.getByRole("button", { name: "Open navigation" }).evaluate(element => element === document.activeElement), true);
      await page.getByRole("button", { name: "Open navigation" }).click();
      await dialog.getByRole("link", { name: "Enquiries", exact: true }).click();
      await page.waitForURL("**/leads");
      assert.equal(await dialog.isVisible(), false);
    }
    assert.deepEqual(errors, [], "Browser runtime errors");
    console.log(`${width}px: eight routes, responsive layouts, campaign drafts/A-B totals, goal editing, enquiry filters, navigation PASS`);
    await context.close();
  }
} finally {
  await browser.close();
  await client.auth.signOut({ scope: "local" });
}
}

async function checkOfflineLeads() {
  const { build } = await import("esbuild");
  const { default: postcss } = await import("postcss");
  const { default: tailwind } = await import("@tailwindcss/postcss");
  const root = fileURLToPath(new URL("../", import.meta.url));
  const output = `${root}test-results/lead-inbox/`;
  await mkdir(output, { recursive: true });
  const css = await postcss([tailwind({ base: root })]).process(await readFile(`${root}src/app/globals.css`, "utf8"), { from: `${root}src/app/globals.css` });
  const font = (await readFile(`${root}node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2`)).toString("base64");
  const bundle = await build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import {LeadInbox} from './src/components/lead-inbox';
      createRoot(document.getElementById('root')).render(<main style={{maxWidth:1160,margin:'24px auto',padding:16}}>
        <h1 style={{fontSize:28,fontWeight:600,marginBottom:20}}>Enquiries</h1>
        <LeadInbox businessName="Fixture Clinic" initialLeads={window.fixture.leads} initialTotal={window.fixture.total}
          initialNextCursor={window.fixture.nextCursor} metaReady /></main>);`, resolveDir: root, loader: "tsx" },
    absWorkingDir: root, bundle: true, write: false, outdir: output, format: "iife", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "offline-next-link", setup(builder) {
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: 'import React from "react"; export default function Link(props){return React.createElement("a",props)}', resolveDir: root, loader: "js" }));
    } }],
  });
  const script = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
  const moduleCss = bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
  const browser = await chromium.launch({ channel: "chrome" });
  const receipts = [];
  try {
    for (const width of [1440, 390, 320]) {
      const rows = ["Asha Verma", "Ravi Shah", "Meera Desai"].map((name, index) => ({
        id: `20000000-0000-4000-8000-00000000000${index + 1}`, business_id: "10000000-0000-4000-8000-000000000001",
        campaign_id: null, meta_lead_id: `fixture-${index}`, form_id: "fixture-form", form_name: "Consultation enquiry",
        full_name: name, phone: index === 0 ? "+910000000000" : null, email: index < 2 ? `fixture-${index}@example.invalid` : null,
        city: "Jaipur", created_time: index === 2 ? null : new Date().toISOString(), created_at: new Date().toISOString(),
        field_data: {}, workflow_status: "new", follow_up_note: "",
      }));
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      const errors = [];
      let listReads = 0;
      let saves = 0;
      let syncs = 0;
      let failList = false;
      page.on("pageerror", error => errors.push(error.message));
      await context.route("**/*", async route => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== "http://lead-inbox.test") { errors.push("Unexpected external request"); return route.abort(); }
        if (url.pathname === "/" && request.method() === "GET") {
          return route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css.css}\n${moduleCss}\n@font-face{font-family:FixtureSans;src:url(data:font/woff2;base64,${font})}body{font-family:FixtureSans,sans-serif}</style></head><body><div id="root"></div><script>window.fixture=${JSON.stringify({ leads: rows.slice(0, 2), total: rows.length, nextCursor: "2" })};${script}</script></body></html>` });
        }
        if (url.pathname === "/api/leads" && request.method() === "GET") {
          listReads++;
          if (failList) return route.fulfill({ status: 503, json: { error: "Synthetic list failure" } });
          const query = url.searchParams.get("query") ?? "";
          const status = url.searchParams.get("status") ?? "all";
          const contact = url.searchParams.get("contact") ?? "all";
          const matching = rows.filter(row => (!query || row.full_name.toLowerCase().includes(query.toLowerCase())) &&
            (status === "all" || row.workflow_status === status) &&
            (contact === "all" || Boolean(row.phone || row.email) === (contact === "ready")));
          const offset = Number(url.searchParams.get("cursor") ?? 0);
          return route.fulfill({ json: { leads: matching.slice(offset, offset + 2), total: matching.length,
            nextCursor: offset + 2 < matching.length ? String(offset + 2) : null } });
        }
        if (url.pathname.startsWith("/api/leads/") && request.method() === "PATCH") {
          saves++;
          if (saves === 1) return route.fulfill({ status: 503, json: { error: "Synthetic save failure" } });
          const row = rows.find(item => url.pathname === `/api/leads/${item.id}`);
          assert.ok(row);
          Object.assign(row, request.postDataJSON());
          return route.fulfill({ json: { lead: row } });
        }
        if (url.pathname === "/api/leads/sync" && request.method() === "POST") {
          syncs++;
          if (syncs === 2) assert.deepEqual(request.postDataJSON(), { syncId: "fixture-sync" });
          return route.fulfill({ json: { leads: [], imported: 0, failedForms: [],
            sync: { id: "fixture-sync", state: syncs === 1 ? "partial" : "complete", hasMore: syncs === 1 } } });
        }
        errors.push(`Unexpected request ${request.method()} ${url.pathname}`);
        return route.abort();
      });
      await page.goto("http://lead-inbox.test/");
      await expect(page.getByText("Asha Verma", { exact: true })).toBeVisible();
      assert.equal(listReads, 0);
      await page.getByRole("button", { name: "Load more enquiries" }).click();
      await expect(page.getByText("Meera Desai", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Follow up Asha Verma" }).click();
      await expect(page.getByLabel("Follow-up status")).toBeFocused();
      await page.getByLabel("Follow-up status").selectOption("booked");
      await page.getByLabel("Follow-up note").fill("Synthetic Friday appointment");
      await page.getByRole("button", { name: "Save follow-up" }).click();
      await expect(page.getByText(/Your edits are still here/)).toBeVisible();
      await expect(page.getByLabel("Follow-up note")).toHaveValue("Synthetic Friday appointment");
      await page.getByRole("button", { name: "Save follow-up" }).click();
      await expect(page.getByText("Follow-up saved.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Follow up Asha Verma" })).toHaveText("booked");
      await page.screenshot({ path: `${output}follow-up-${width}.png`, fullPage: true });
      await page.reload();
      await page.getByRole("button", { name: "Follow up Asha Verma" }).click();
      await expect(page.getByLabel("Follow-up note")).toHaveValue("Synthetic Friday appointment");
      await expect(page.getByLabel("Follow-up status")).toHaveValue("booked");
      await page.getByRole("button", { name: "Close follow-up" }).click();
      await page.getByLabel("Workflow status").selectOption("booked");
      await expect(page.getByRole("status")).toHaveText("1 of 1 enquiries");
      await page.getByRole("button", { name: "Sync leads", exact: true }).click();
      await expect(page.getByText(/Sync incomplete/)).toBeVisible();
      await page.getByRole("button", { name: "Resume sync" }).click();
      await expect(page.getByText("You're up to date — no new leads.")).toBeVisible();
      await expect(page.getByText("Asha Verma", { exact: true })).toBeVisible();
      await page.getByLabel("Search enquiries").fill("no-match");
      await expect(page.getByRole("heading", { name: "No matching enquiries" })).toBeVisible();
      failList = true;
      await page.getByLabel("Search enquiries").fill("unavailable");
      await expect(page.getByRole("button", { name: "Retry list" })).toBeVisible();
      failList = false;
      await page.getByRole("button", { name: "Retry list" }).click();
      await expect(page.getByRole("heading", { name: "No matching enquiries" })).toBeVisible();
      await page.getByRole("button", { name: "Clear filters", exact: true }).click();
      await expect(page.getByText("Asha Verma", { exact: true })).toBeVisible();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const clipped = await page.locator("button,input,select,textarea").evaluateAll(elements => elements.filter(element => {
        const bounds = element.getBoundingClientRect();
        return bounds.width > 0 && (bounds.left < -1 || bounds.right > innerWidth + 1 || element.scrollWidth > element.clientWidth + 1);
      }).map(element => element.getAttribute("aria-label") || element.textContent));
      assert.deepEqual(clipped, []);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `${output}inbox-${width}.png`, fullPage: true });
      receipts.push({ width, listReads, saves, syncs, result: "pass" });
      console.log(`PASS enquiry workflow at ${width}px: paging, failed save/retry, reload, filters, partial sync/resume, errors, layout`);
      await context.close();
    }
    await writeFile(`${output}receipt.json`, JSON.stringify({ transport: "fully synthetic", receipts }, null, 2));
  } finally {
    await browser.close();
  }
}