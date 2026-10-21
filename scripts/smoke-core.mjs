import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { chromium } from "@playwright/test";

const envPath = "/Users/vanshulgoyal/Development/copilot/adbrain/.env.smoke";

const origin = "https://adbrain.vanshul.com";
const modes = new Set(process.argv.slice(2));
if ([...modes].some((mode) => !["--create", "--campaign", "--help"].includes(mode))) {
  throw new Error("Supported modes: --create, --campaign, --help.");
}
if (modes.has("--help")) {
  console.log("npm run smoke:core [-- --create | -- --campaign]");
  process.exit(0);
}
assert.ok(!(modes.has("--create") && modes.has("--campaign")), "Run only one mutating mode at a time.");

const { SMOKE_EMAIL: email, SMOKE_PASSWORD: password } = parseEnv(await readFile(envPath, "utf8"));
assert.ok(email && password, "Set SMOKE_EMAIL and SMOKE_PASSWORD in the ignored .env.smoke file.");

let browser;
let signedIn = false;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: "block" });
  context.setDefaultTimeout(20_000);
  const page = await context.newPage();
  const errors = [];
  let loginAllowed = true;
  let skippedLeadSync = false;
  let skippedCampaignSync = false;
  let interviewCount = 0;
  let generationCount = 0;
  let generationRequest = null;
  let campaignSetup = false;
  let campaignReviewed = false;
  let campaignCreateCount = 0;
  let campaignSyncAllowed = false;
  let campaignSyncCount = 0;
  let campaignId = null;
  let campaignPauseCount = 0;
  let campaignDeleteCount = 0;
  let campaignPaused = false;
  let planCount = 0;
  let draftCount = 0;
  let preflightCount = 0;
  page.on("pageerror", (error) => errors.push(error.name === "EvalError" ? "CSP eval error" : `page error (${error.name})`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const source = message.location().url;
    const path = source ? new URL(source).pathname : "unknown source";
    if (path === "/api/campaigns/sync" && skippedCampaignSync) return;
    const status = message.text().match(/\b(?:40[0-9]|50[0-9])\b/)?.[0];
    errors.push(message.text().includes("Content Security Policy") ? `CSP violation at ${path}` : `console error at ${path}${status ? ` (HTTP ${status})` : ""}`);
  });
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST" && url.origin === origin && url.pathname === "/api/leads/sync") {
      skippedLeadSync = true;
      return route.fulfill({ json: { leads: [], imported: 0, sync: { id: "smoke-read-only", state: "partial", hasMore: true } } });
    }
    if (request.method() === "POST" && url.origin === origin && url.pathname === "/api/campaigns/sync") {
      if (modes.has("--campaign") && campaignSyncAllowed && campaignSyncCount++ === 0) return route.continue();
      skippedCampaignSync = true;
      return route.fulfill({ status: 503, json: { error: "Automatic sync suppressed in read-only smoke." } });
    }
    if (request.method() === "POST" && url.origin === origin && url.pathname === "/api/events") {
      return route.fulfill({ status: 204, body: "" });
    }
    if (request.method() === "POST" && url.hostname.endsWith(".supabase.co") && url.pathname === "/rest/v1/web_events") {
      return route.fulfill({ status: 201, json: [] });
    }
    if (request.method() === "POST" && loginAllowed && url.hostname.endsWith(".supabase.co")
      && url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
      loginAllowed = false;
      return route.continue();
    }
    if (modes.has("--create") && request.method() === "POST" && url.origin === origin) {
      if (url.pathname === "/api/creatives/assistant" && ++interviewCount <= 8) return route.continue();
      if (url.pathname === "/api/creatives/generate" && generationCount === 0 && request.postDataJSON()?.count === 3) {
        generationRequest = request.postDataJSON();
        generationCount = 1;
        return route.continue();
      }
    }
    if (modes.has("--campaign") && url.origin === origin) {
      if (campaignSetup && request.method() === "POST" && url.pathname === "/api/campaigns/plan" && planCount++ === 0) return route.continue();
      if (campaignSetup && request.method() === "POST" && url.pathname === "/api/campaign-drafts" && draftCount++ === 0) return route.continue();
      if (campaignSetup && request.method() === "POST" && url.pathname === "/api/campaigns/preflight" && preflightCount++ === 0) return route.continue();
      if (campaignReviewed && request.method() === "POST" && url.pathname === "/api/campaigns/create" && campaignCreateCount++ === 0) return route.continue();
      if (campaignId && url.pathname === `/api/campaigns/${campaignId}`) {
        if (request.method() === "PATCH" && request.postDataJSON()?.status === "paused" && campaignPauseCount++ < 2) return route.continue();
        if (request.method() === "DELETE" && campaignDeleteCount++ === 0) return route.continue();
      }
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) return route.abort("blockedbyclient");
    if (url.origin === origin && (/^\/api\/(cron|scheduler)\//.test(url.pathname) || url.pathname.startsWith("/api/meta/oauth/"))) {
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });

  await page.goto(`${origin}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const loginResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/auth/v1/token" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Sign in with password", exact: true }).click();
  const response = await loginResponse;
  assert.equal(response.status(), 200, "Login failed.");
  await page.waitForURL((url) => url.origin === origin && !url.pathname.startsWith("/login"));
  signedIn = true;
  console.log("PASS Sign in");

  for (const [label, path] of [["Dashboard", "/dashboard"], ["Brand", "/brand"], ["Review", "/studio"], ["Campaigns", "/campaigns"], ["Enquiries", "/leads"]]) {
    errors.length = 0;
    try {
      const pageResponse = await page.goto(`${origin}${path}`, { waitUntil: "domcontentloaded" });
      assert.equal(pageResponse?.status(), 200, "HTTP response was not 200");
      await page.locator("main h1").first().waitFor({ state: "visible" });
      await page.waitForLoadState("load");
      await page.waitForTimeout(1_000);
      assert.equal(new URL(page.url()).pathname, path, "Unexpected redirect");
      assert.equal(errors.length, 0, errors[0] ?? "Browser error");
      console.log(`PASS ${label}${path === "/leads" && skippedLeadSync || path === "/campaigns" && skippedCampaignSync ? " (automatic sync suppressed)" : ""}`);
    } catch (error) {
      console.log(`FAIL ${label}: ${error instanceof Error ? error.message.split("\n")[0].slice(0, 180) : "Unknown error"}`);
      process.exitCode = 1;
    }
  }
  if (modes.has("--create")) {
    let savedCount = null;
    async function recoverSavedCount() {
      if (!generationRequest?.generationId || !generationRequest?.businessId) return null;
      try {
        const status = await page.evaluate(async ({ businessId, generationId }) => {
          const query = new URLSearchParams({ businessId, generationId, expectedCount: "3" });
          const result = await fetch(`/api/creatives/generate?${query}`);
          return result.ok ? await result.json() : null;
        }, generationRequest);
        return Array.isArray(status?.creatives) ? status.creatives.length : null;
      } catch { return null; }
    }
    try {
      assert.equal(process.exitCode ?? 0, 0, "Read-only views failed; paid run was not started");
      await page.goto(`${origin}/create`);
      await page.getByRole("textbox", { name: "Campaign goal" }).fill("Introduce our team to local customers using only verified Brand Brain facts. Avoid unsupported claims.");
      await page.getByRole("button", { name: "Start creating" }).click();
      const brief = page.getByRole("textbox", { name: "Creative brief", exact: true });
      for (let attempt = 0; attempt < 8 && !await brief.isVisible(); attempt++) {
        const decision = page.getByRole("region", { name: "Conversation history" }).locator("button:not([disabled])").first();
        await decision.waitFor({ state: "visible", timeout: 60_000 });
        await decision.click();
      }
      await brief.waitFor({ state: "visible" });
      const result = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/creatives/generate" && response.request().method() === "POST", { timeout: 300_000 });
      await page.getByRole("button", { name: "Generate 3 ads" }).click();
      const response = await result;
      const data = await response.json();
      savedCount = Array.isArray(data.creatives) ? data.creatives.length : null;
      if (response.status() !== 200 || savedCount !== 3) {
        savedCount = await recoverSavedCount();
      }
      assert.equal(generationCount, 1, "Paid Create request was blocked");
      assert.equal(response.status(), 200, `Create returned HTTP ${response.status()}`);
      assert.equal(savedCount, 3, `Create saved ${savedCount}/3 ads; do not retry before checking saved work`);
      await page.getByRole("button", { name: "Open in Creative Studio" }).waitFor({ state: "visible" });
      assert.equal(errors.length, 0, errors[0] ?? "Browser error after Create");
      console.log(`PASS Create: ${savedCount}/3 saved (one paid run; record in #88)`);
    } catch (error) {
      if (generationCount && savedCount === null) savedCount = await recoverSavedCount();
      console.log(`FAIL Create${generationCount ? `: ${savedCount ?? "unconfirmed"}/3 saved` : ""}: ${error instanceof Error ? error.message.split("\n")[0].slice(0, 180) : "Unknown error"}; ${generationCount ? "check saved work before any retry" : "no paid request sent"}`);
      process.exitCode = 1;
    }
  }
  if (modes.has("--campaign")) {
    const name = `QA Solaride paused smoke ${crypto.randomUUID().slice(0, 8)}`;
    try {
      assert.equal(process.exitCode ?? 0, 0, "Read-only views failed; campaign was not started");
      await page.goto(`${origin}/campaigns`);
      assert.equal((await page.getByRole("complementary", { name: "Main sidebar" }).locator('a[href="/brand"] strong').first().innerText()).trim(), "Solaride", "Select the Solaride workspace before campaign smoke");
      const open = page.getByRole("button", { name: "New campaign", exact: true });
      if (await open.isVisible()) await open.click();
      const creative = page.locator('#campaign-composer button[aria-pressed="false"]').first();
      await creative.waitFor({ state: "visible" });
      await creative.click();
      await page.getByRole("textbox", { name: "Campaign name", exact: true }).fill(name);
      await page.locator("#budget").fill("350");
      const form = page.locator("#leadform");
      const solarideForm = await form.locator("option").filter({ hasText: /solaride/i }).first().getAttribute("value");
      assert.ok(solarideForm, "No Solaride lead form; nothing created");
      await form.selectOption(solarideForm);
      campaignSetup = true;
      await page.getByRole("button", { name: "Prepare campaign review" }).click();
      const review = page.getByRole("region", { name: "Campaign review result" });
      await review.getByRole("button", { name: "Send to Meta (paused)" }).waitFor({ state: "visible", timeout: 120_000 });
      assert.match(await review.innerText(), /Account: Solaride\b/i, "Meta account is not Solaride; no campaign created");
      assert.match(await review.innerText(), /Destination: Instant lead form/i, "Unexpected destination; no campaign created");
      console.log("PASS Prepare (Solaride account and lead form)");
      campaignReviewed = true;
      const completed = page.waitForResponse(async (response) => {
        if (!/^\/api\/campaigns\/(create|operations\/[^/]+)$/.test(new URL(response.url()).pathname) || !response.ok()) return false;
        const result = await response.json().catch(() => null);
        return result?.data?.state === "succeeded" && Boolean(result.data.campaignId);
      }, { timeout: 120_000 });
      await review.getByRole("button", { name: "Send to Meta (paused)" }).click();
      campaignId = (await (await completed).json()).data.campaignId;
      await page.getByText("Paused campaign created.", { exact: false }).first().waitFor({ state: "visible", timeout: 120_000 });
      console.log("PASS Launch PAUSED");
      await page.waitForLoadState("load");
      await page.waitForTimeout(1_000);
      campaignSyncAllowed = true;
      const sync = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/campaigns/sync" && response.request().method() === "POST");
      await page.getByRole("button", { name: "Sync from Meta" }).click();
      assert.equal((await sync).status(), 200, "Campaign sync failed");
      assert.equal(campaignSyncCount, 1, "Campaign sync request was blocked");
      console.log("PASS Sync");
      const row = page.getByRole("heading", { name, exact: true }).locator("xpath=../../../..");
      await row.getByRole("button", { name: "Resume" }).waitFor({ state: "visible" });
      const paused = await page.evaluate(async (id) => {
        const response = await fetch(`/api/campaigns/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "paused" }) });
        return response.status;
      }, campaignId);
      assert.equal(paused, 200, "Campaign pause failed");
      assert.equal(campaignPauseCount, 1, "Campaign pause request was blocked");
      campaignPaused = true;
      console.log("PASS Pause (confirmed PAUSED)");
      await row.getByRole("button", { name: "Resume" }).click();
      const connectionReview = page.getByRole("dialog", { name: "Connected to Meta" });
      await connectionReview.getByRole("button", { name: "Review activation" }).waitFor({ state: "visible" });
      await connectionReview.getByRole("button", { name: "Close connection dialog" }).click();
      console.log("PASS Resume review entry (delivery remains PAUSED; activation not requested)");
    } catch (error) {
      console.log(`FAIL Campaign (${name}): ${error instanceof Error ? error.message.split("\n")[0].slice(0, 180) : "Unknown error"}${campaignCreateCount && !campaignId ? "; reconcile operation by name before rerunning" : ""}`);
      process.exitCode = 1;
    } finally {
      if (campaignId) {
        try {
          if (!campaignPaused) {
            const paused = await page.evaluate(async (id) => {
              const response = await fetch(`/api/campaigns/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "paused" }) });
              return response.status;
            }, campaignId);
            assert.equal(paused, 200, "Could not confirm PAUSED before cleanup");
            campaignPaused = true;
          }
          const deleted = await page.evaluate(async (id) => {
            const response = await fetch(`/api/campaigns/${id}`, { method: "DELETE" });
            return { status: response.status, result: await response.json() };
          }, campaignId);
          assert.equal(deleted.status, 200, "Campaign deletion failed");
          assert.equal(deleted.result.metaDeleted, true, "Meta removal was not confirmed");
          console.log("PASS Archive (deleted test campaign from Meta and AdBrain)");
        } catch {
          console.log(`FAIL Archive: test campaign ${campaignId} may remain PAUSED; reconcile manually`);
          process.exitCode = 1;
        }
      }
    }
  }
} catch (error) {
  console.log(`FAIL ${!browser ? "Browser" : signedIn ? "Smoke" : "Sign in"}: ${error instanceof Error ? error.message.split("\n")[0].slice(0, 180) : "Unknown error"}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
}