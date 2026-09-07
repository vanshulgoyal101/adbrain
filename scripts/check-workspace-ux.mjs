import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";

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
      if (route.request().method() === "GET") return route.continue();
      if (new URL(route.request().url()).pathname === "/api/leads/sync") return route.fulfill({ json: { leads: fixtures, imported: 3 } });
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
        await page.getByRole("button", { name: "Promote an existing offer" }).click();
        assert.ok((await goal.inputValue()).includes("Ask me to confirm"));
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
          assert.equal(await page.getByText("Ravi Shah", { exact: true }).count(), 1);
          await page.getByRole("button", { name: "Clear filters", exact: true }).click();
          await page.getByRole("combobox", { name: "Contact availability" }).selectOption("missing");
          assert.equal(await page.getByText("Meera Desai", { exact: true }).count(), 1);
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