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

async function readCreateResponse(response) {
  const contentType = await response.headerValue("content-type");
  if (!contentType?.includes("application/x-ndjson")) {
    return { status: response.status(), data: await response.json().catch(() => ({})) };
  }
  const text = await response.text();
  let result;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const event = JSON.parse(line);
    if (event.type === "result") result = event;
  }
  assert.ok(result, "Create stream ended without a result.");
  return { status: result.status, data: result.body };
}

const { SMOKE_EMAIL: email, SMOKE_PASSWORD: password } = process.env.SMOKE_EMAIL
  ? process.env
  : parseEnv(await readFile(envPath, "utf8"));
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
  let savedDraft = null;
  let draftDeleteCount = 0;
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
    if (campaignSetup && request.method() === "POST" && url.origin === origin) {
      // #497: choosing an ad starts a background plan, and Prepare may plan again. Both are read-only.
      if (url.pathname === "/api/campaigns/plan" && planCount++ < 2) return route.continue();
      if (url.pathname === "/api/campaign-drafts" && draftCount++ === 0) {
        const response = await route.fetch();
        const draft = (await response.json().catch(() => null))?.data;
        if (response.ok() && draft?.draftId) savedDraft = { id: draft.draftId, version: draft.version };
        return route.fulfill({ response });
      }
      if (url.pathname === "/api/campaigns/preflight" && preflightCount++ === 0) return route.continue();
    }
    if (!modes.has("--campaign") && savedDraft && request.method() === "DELETE" && url.origin === origin
      && url.pathname === `/api/campaign-drafts/${savedDraft.id}` && draftDeleteCount++ === 0) return route.continue();
    if (modes.has("--campaign") && url.origin === origin) {
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
  const emailField = page.getByLabel("Email", { exact: true });
  const passwordField = page.getByLabel("Password", { exact: true });
  await emailField.waitFor();
  // #289: a new browser opens on "Create your free account"; an existing user taps "Sign in" for the password form.
  // A click before hydration does nothing, so retry until the password field shows.
  for (let attempt = 0; attempt < 5 && !(await passwordField.isVisible()); attempt++) {
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await passwordField.waitFor({ state: "visible", timeout: 3_000 }).catch(() => {});
  }
  await emailField.fill(email);
  await passwordField.fill(password);
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
  if (!modes.has("--campaign")) {
    // Every deploy: Prepare one paused-campaign review, never send it, then delete its draft.
    const name = `QA preflight smoke ${crypto.randomUUID().slice(0, 8)}`;
    try {
      assert.equal(process.exitCode ?? 0, 0, "Read-only views failed; Prepare was not started");
      errors.length = 0;
      await page.goto(`${origin}/campaigns`);
      // A click that lands before hydration is lost, so reopen until an approved ad is offered.
      const toggle = page.locator('button[aria-controls="campaign-composer"]');
      const creative = page.locator('#campaign-composer button[aria-pressed="false"]').first();
      for (let attempt = 0; attempt < 6 && !await creative.isVisible(); attempt++) {
        if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
        await creative.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
      }
      if (!await creative.isVisible()) {
        const ads = await page.locator("#campaign-composer button[aria-pressed]").count();
        throw new Error(`No selectable approved ad (setup ${await toggle.getAttribute("aria-expanded") === "true" ? "open" : "closed"}, ${ads} ads shown)`);
      }
      // Choosing the ad starts #497's background plan, so open the read-only setup allowances first (#531).
      campaignSetup = true;
      await creative.click();
      await page.getByRole("textbox", { name: "Campaign name", exact: true }).fill(name);
      await page.locator("#budget").fill("350");
      const form = page.locator("#leadform");
      const leadForm = await form.locator('option:not([value=""])').first().getAttribute("value", { timeout: 30_000 }).catch(() => null);
      assert.ok(leadForm, `No lead form loaded (${(await form.locator("option").first().innerText().catch(() => "no lead form field")).trim()})`);
      await form.selectOption(leadForm);
      const preflight = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/campaigns/preflight" && response.request().method() === "POST", { timeout: 90_000 });
      preflight.catch(() => undefined);
      await page.getByRole("button", { name: "Check my campaign (nothing spends)" }).click();
      const response = await preflight.catch(async (error) => {
        const alert = page.getByRole("alert").first();
        const message = await alert.isVisible() ? (await alert.innerText()).trim() : "";
        throw message ? new Error(`Prepare stopped: ${message}`) : error;
      });
      campaignSetup = false;
      const review = (await response.json().catch(() => null))?.data;
      assert.equal(response.status(), 200, `Preflight returned HTTP ${response.status()}`);
      const blockers = (review?.blockers ?? []).map((blocker) => blocker.message);
      const unexpected = blockers.filter((message) => !message.startsWith("Add your business website"));
      assert.equal(unexpected.length, 0, `Preflight blocked: ${unexpected[0]}`);
      assert.equal(review.selected?.currency, "INR", "No INR Meta ad account selected");
      const result = page.getByRole("region", { name: "Campaign review result" });
      await result.getByText(`Account: ${review.selected.accountName}`, { exact: false }).waitFor({ state: "visible" });
      const send = result.getByRole("button", { name: "Send to Meta (paused)" });
      if (blockers.length) assert.equal(await send.count(), 0, "Send to Meta is offered despite a blocker");
      else await send.waitFor({ state: "visible" });
      assert.equal(errors.length, 0, errors[0] ?? "Browser error during Prepare");
      console.log(`PASS Prepare preflight (${review.selected.accountName}, ${review.resolvedAreaLabel ?? "area unresolved"}; ${blockers.length ? "Send held only by the missing business website" : "ready to send paused"}; nothing sent to Meta)`);
    } catch (error) {
      console.log(`FAIL Prepare preflight: ${error instanceof Error ? error.message.split("\n")[0].slice(0, 180) : "Unknown error"}; nothing sent to Meta`);
      process.exitCode = 1;
    } finally {
      campaignSetup = false;
      if (savedDraft) {
        const removed = await page.evaluate(async ({ id, version }) => {
          const result = await fetch(`/api/campaign-drafts/${id}?version=${version}`, { method: "DELETE" });
          return result.status;
        }, savedDraft).catch(() => 0);
        if (removed === 200) console.log("PASS Remove preflight draft");
        else {
          console.log(`FAIL Remove preflight draft: HTTP ${removed}; remove "${name}" from Saved drafts`);
          process.exitCode = 1;
        }
      }
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
      await page.getByRole("button", { name: /^(Start creating|Edit brief)$/ }).click(); // #1004: a complete Brand offers "Edit brief" to keep the brief review
      // Answer the assistant's questions until the brief is ready; it can also skip straight to it.
      const generate = page.getByRole("button", { name: "Generate 3 ads", exact: true });
      // Answer buttons only: not the conversation's own navigation (#284).
      const decision = page.getByRole("region", { name: "Conversation history" }).locator("button:not([disabled])")
        .filter({ hasNotText: /^\s*(Revise goal|Change my answer|Start over)\s*$/i }).first();
      // A failed assistant turn shows "Try again", as a user would press it (#410).
      const retry = page.getByRole("button", { name: "Try again", exact: true });
      let retries = 0;
      for (let attempt = 0; attempt < 8; attempt++) {
        await generate.or(decision).or(retry).first().waitFor({ state: "visible", timeout: 60_000 });
        if (await generate.isVisible()) break;
        if (await retry.isVisible()) { retries++; await retry.click(); continue; }
        await decision.click();
      }
      if (retries) console.log(`NOTE Create assistant failed ${retries}×; pressed Try again each time (#410)`);
      await generate.waitFor({ state: "visible" });
      const result = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/creatives/generate" && response.request().method() === "POST", { timeout: 300_000 });
      await generate.click();
      const response = await result;
      const create = await readCreateResponse(response);
      savedCount = Array.isArray(create.data?.creatives) ? create.data.creatives.length : null;
      if (create.status !== 200 || savedCount !== 3) {
        savedCount = await recoverSavedCount();
      }
      assert.equal(generationCount, 1, "Paid Create request was blocked");
      assert.equal(create.status, 200, `Create returned HTTP ${create.status}`);
      assert.equal(savedCount, 3, `Create saved ${savedCount}/3 ads; do not retry before checking saved work`);
      await page.getByRole("button", { name: "Review ads" }).waitFor({ state: "visible" });
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
      // Choosing the ad starts #497's background plan, so open the read-only setup allowances first (#531).
      campaignSetup = true;
      await creative.click();
      await page.getByRole("textbox", { name: "Campaign name", exact: true }).fill(name);
      await page.locator("#budget").fill("350");
      const form = page.locator("#leadform");
      const solarideForm = await form.locator("option").filter({ hasText: /solaride/i }).first().getAttribute("value");
      assert.ok(solarideForm, "No Solaride lead form; nothing created");
      await form.selectOption(solarideForm);
      campaignSetup = true;
      await page.getByRole("button", { name: "Check my campaign (nothing spends)" }).click();
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