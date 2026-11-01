import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { chromium } from "@playwright/test";
import { loginAuth, loginSessionProblem, makesFreePictures } from "./lib/internal-accounts.mjs";
import { pictureSources } from "./lib/smoke-pictures.mjs";
import { forgiveRecoveredBusyTurns } from "./lib/smoke-console.mjs";
import { createFailureLines, parseCreateStream } from "./lib/smoke-create-failures.mjs";

const envPath = "/Users/vanshulgoyal/Development/copilot/adbrain/.env.smoke";

const origin = "https://adbrain.vanshul.com";
const modes = new Set(process.argv.slice(2));
const mutating = ["--create", "--campaign", "--picture", "--prepare"];
if ([...modes].some((mode) => ![...mutating, "--help"].includes(mode))) {
  throw new Error("Supported modes: --create, --campaign, --picture, --prepare, --help.");
}
if (modes.has("--help")) {
  console.log("npm run smoke:core [-- --create | -- --campaign | -- --picture | -- --prepare]");
  process.exit(0);
}
assert.ok(mutating.filter((mode) => modes.has(mode)).length <= 1, "Run only one mutating mode at a time.");

/** Campaigns → open setup → the first approved ad (not yet clicked). A click before hydration is lost, so reopen until one shows. */
async function approvedAd(page) {
  await page.goto(`${origin}/campaigns`);
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
  return creative;
}

async function readCreateResponse(response) {
  const contentType = await response.headerValue("content-type");
  if (!contentType?.includes("application/x-ndjson")) {
    return { status: response.status(), data: await response.json().catch(() => ({})) };
  }
  return createStreamResult(await response.text());
}

/** #2504: the Create response from text the page teed; JSON when Create refused before streaming. */
async function createFromText(text, status, contentType) {
  try {
    return contentType?.includes("application/x-ndjson") ? createStreamResult(text) : { status, data: JSON.parse(text) };
  } catch { return null; }
}

function createStreamResult(text) {
  const { result } = parseCreateStream(text);
  assert.ok(result, "Create stream ended without a result.");
  return { status: result.status, data: result.body };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HAS_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const FREE_PICTURES = ["pollinations", "cloudflare"];
const BACKGROUND_INSTRUCTION = "plain light studio background";

/** Supabase REST and Storage as the signed-in owner (#2145), so RLS scopes every read and delete. */
async function supabaseFetch(auth, path, init = {}) {
  assert.ok(auth?.apikey && auth.token, "session unknown");
  return fetch(`${auth.supabase}${path}`, {
    ...init,
    headers: { apikey: auth.apikey, authorization: `Bearer ${auth.token}`, "content-type": "application/json", ...init.headers },
  });
}

async function businessAds(auth, businessId) {
  assert.ok(UUID.test(businessId ?? ""), "business id unknown");
  const response = await supabaseFetch(auth, `/rest/v1/creatives?business_id=eq.${businessId}&select=id,variant_group,created_at,image_url,generation`);
  assert.ok(response.ok, `ads not read (HTTP ${response.status})`);
  return response.json();
}

/** Every file under `<business>/<group>/` in the creatives bucket: originals, thumbnails and composed ads. */
async function groupFiles(auth, businessId, group) {
  assert.ok(UUID.test(businessId ?? "") && UUID.test(group ?? ""), "picture folder unknown");
  const files = [];
  async function list(folder, depth) {
    const response = await supabaseFetch(auth, "/storage/v1/object/list/creatives", {
      method: "POST", body: JSON.stringify({ prefix: folder, limit: 1000, offset: 0 }),
    });
    assert.ok(response.ok, `pictures not listed (HTTP ${response.status})`);
    for (const entry of await response.json()) {
      if (entry.id) files.push(`${folder}/${entry.name}`);
      else if (depth < 2) await list(`${folder}/${entry.name}`, depth + 1);
    }
  }
  await list(`${businessId}/${group}`, 0);
  return files;
}

async function deleteFiles(auth, files) {
  if (!files.length) return;
  const removed = await supabaseFetch(auth, "/storage/v1/object/creatives", { method: "DELETE", body: JSON.stringify({ prefixes: files }) });
  assert.ok(removed.ok, `pictures not deleted (HTTP ${removed.status})`);
}

/** A stored file's name without folder or extension; `persistCreativeImageBytes` makes it `<angle>-<uuid>`. */
const fileStem = (path) => path.split("/").pop().replace(/\.[^.]+$/, "");
const urlStem = (url) => {
  try { return fileStem(new URL(url).pathname); } catch { return ""; }
};

/**
 * #2145: a dispatched `--create` deletes its own ads and their files under `<business>/<generation>/`, as the
 * signed-in owner, so repeated runs don't fill the 1 GB free Storage. Rows first: a failed file delete leaves
 * orphan files, never broken ads. When the run's ads are the business's only ads, the newest one stays so the
 * scheduled `--picture` smoke has an ad to change.
 */
async function removeCreateRun(auth, { businessId, generationId } = {}) {
  assert.ok(UUID.test(businessId ?? "") && UUID.test(generationId ?? ""), "run ids unknown");
  const ads = await businessAds(auth, businessId);
  const run = ads.filter((ad) => ad.variant_group === generationId).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const keep = run.length && run.length === ads.length ? run[0] : null;
  const remove = run.filter((ad) => ad !== keep && UUID.test(ad.id));
  let deleted = 0;
  if (remove.length) {
    const rows = await supabaseFetch(auth, `/rest/v1/creatives?business_id=eq.${businessId}&variant_group=eq.${generationId}&id=in.(${remove.map((ad) => ad.id).join(",")})&select=id`,
      { method: "DELETE", headers: { prefer: "return=representation" } });
    assert.ok(rows.ok, `ads not deleted (HTTP ${rows.status})`);
    deleted = (await rows.json()).length;
  }
  const kept = JSON.stringify(ads.filter((ad) => !remove.includes(ad)).map((ad) => [ad.image_url, ad.generation]));
  const files = (await groupFiles(auth, businessId, generationId)).filter((path) => !kept.includes(fileStem(path)));
  await deleteFiles(auth, files);
  return { ads: deleted, files: files.length, kept: Boolean(keep) };
}

/**
 * #2145/#1891: a new background is stored under new file names, so the scheduled run deletes the picture and
 * composed ad it replaced (originals and thumbnails), only inside that ad's `<business>/<group>/` folder and only
 * when no ad of the business still refers to them.
 */
async function removeReplacedPictures(auth, before) {
  const group = before.variant_group ?? before.id;
  const ads = await businessAds(auth, before.business_id);
  const referenced = JSON.stringify(ads.map((ad) => [ad.image_url, ad.generation]));
  const stems = new Set([before.image_url, before.generation?.photoUrl].filter((url) => typeof url === "string")
    .map(urlStem).filter((stem) => HAS_UUID.test(stem) && !referenced.includes(stem)));
  if (!stems.size) return 0;
  const files = (await groupFiles(auth, before.business_id, group)).filter((path) => stems.has(fileStem(path)));
  await deleteFiles(auth, files);
  return files.length;
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
  if (modes.has("--create")) {
    // #2504: Chrome drops a long Create stream's body before Playwright reads it (#1123), so a short run never said
    // which ad failed. Tee the stream in the page; the page still reads its own copy as it arrives.
    await context.addInitScript(() => {
      const send = window.fetch;
      window.fetch = async (input, init) => {
        const response = await send(input, init);
        try {
          const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, location.href);
          const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
          if (method === "POST" && url.pathname === "/api/creatives/generate") {
            window.__smokeCreateStream = response.clone().text().catch(() => null);
          }
        } catch { /* never break the page's own request */ }
        return response;
      };
    });
  }
  const page = await context.newPage();
  const errors = [];
  /** @type {Promise<boolean>[]} one per 503 assistant turn: whether its code was AI_BUSY (#2396) */
  const assistantBusy = [];
  const smokeBlocked = new Set();
  let loginAllowed = true;
  let loginSession = null;
  let skippedLeadSync = false;
  let skippedCampaignSync = false;
  let interviewCount = 0;
  let generationCount = 0;
  let generationRequest = null;
  const cleanUpCreateRun = async () => {
    if (process.env.SMOKE_CREATE_CLEANUP !== "1") return;
    try {
      const removed = await removeCreateRun(auth, generationRequest);
      console.log(`PASS Cleanup: deleted ${removed.ads} ads and ${removed.files} files${removed.kept ? "; kept the newest ad for the --picture smoke" : ""}`);
    } catch (error) {
      console.log(`FAIL Cleanup: ${error instanceof Error ? error.message.split("\n")[0].slice(0, 180) : "Unknown error"}; delete this run's ads in Review`);
      process.exitCode = 1;
    }
  };
  let campaignSetup = false;
  let goLiveSetup = false;
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
  let removingDraft = null;
  let pictureAllowed = null;
  page.on("pageerror", (error) => errors.push(error.name === "EvalError" ? "CSP eval error" : `page error (${error.name})`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const source = message.location().url;
    const path = source ? new URL(source).pathname : "unknown source";
    if (path === "/api/campaigns/sync" && skippedCampaignSync) return;
    // #2396: a write the smoke aborts on purpose (Go live's create) is not a product error.
    if (smokeBlocked.has(path) && message.text().includes("ERR_BLOCKED_BY_CLIENT")) return;
    const status = message.text().match(/\b(?:40[0-9]|50[0-9])\b/)?.[0];
    errors.push(message.text().includes("Content Security Policy") ? `CSP violation at ${path}` : `console error at ${path}${status ? ` (HTTP ${status})` : ""}`);
  });
  page.on("response", (response) => {
    if (response.status() !== 503 || new URL(response.url()).pathname !== "/api/creatives/assistant") return;
    assistantBusy.push(response.json().then((body) => body?.code === "AI_BUSY", () => false));
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
      // #2396: read the session here. After sign-in the page navigates and Chromium drops the response body,
      // so reading it from the page's response afterwards lost the identity on some runs.
      const response = await route.fetch().catch(() => null);
      if (!response) return route.abort("failed");
      loginSession = { status: response.status(), supabase: url.origin, apikey: request.headers().apikey,
        body: await response.json().catch(() => null) };
      return route.fulfill({ response });
    }
    if (modes.has("--create") && request.method() === "POST" && url.origin === origin) {
      if (url.pathname === "/api/creatives/assistant" && ++interviewCount <= 8) return route.continue();
      if (url.pathname === "/api/creatives/generate" && generationCount === 0 && request.postDataJSON()?.count === 3) {
        generationRequest = request.postDataJSON();
        generationCount = 1;
        return route.continue();
      }
    }
    // --picture: one background change per allowance, for the ad the smoke chose.
    if (pictureAllowed && request.method() === "POST" && url.origin === origin && url.pathname === `/api/creatives/${pictureAllowed}/background`) {
      pictureAllowed = null;
      return route.continue();
    }
    if ((campaignSetup || goLiveSetup) && ["POST", "PUT"].includes(request.method()) && url.origin === origin) {
      // #497: choosing an ad starts a background plan, and Prepare may plan again. Both are read-only.
      if (url.pathname === "/api/campaigns/plan" && planCount++ < 2) return route.continue();
      // #1151: Prepare updates (PUT) a saved draft with the same ads instead of adding one; either save is the
      // smoke account's own draft row, removed afterwards, and nothing reaches Meta.
      const draftSave = (request.method() === "POST" && url.pathname === "/api/campaign-drafts")
        || (request.method() === "PUT" && /^\/api\/campaign-drafts\/[0-9a-f-]{36}$/.test(url.pathname));
      if (draftSave && draftCount++ === 0) {
        const response = await route.fetch();
        const draft = (await response.json().catch(() => null))?.data;
        if (response.ok() && draft?.draftId) savedDraft = { id: draft.draftId, version: draft.version };
        return route.fulfill({ response });
      }
      if (url.pathname === "/api/campaigns/preflight" && preflightCount++ === 0) return route.continue();
    }
    if (!modes.has("--campaign") && removingDraft && request.method() === "DELETE" && url.origin === origin
      && url.pathname === `/api/campaign-drafts/${removingDraft}` && draftDeleteCount++ === 0) return route.continue();
    if (modes.has("--campaign") && url.origin === origin) {
      if (campaignReviewed && request.method() === "POST" && url.pathname === "/api/campaigns/create" && campaignCreateCount++ === 0) return route.continue();
      if (campaignId && url.pathname === `/api/campaigns/${campaignId}`) {
        if (request.method() === "PATCH" && request.postDataJSON()?.status === "paused" && campaignPauseCount++ < 2) return route.continue();
        if (request.method() === "DELETE" && campaignDeleteCount++ === 0) return route.continue();
      }
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())
      || (url.origin === origin && (/^\/api\/(cron|scheduler)\//.test(url.pathname) || url.pathname.startsWith("/api/meta/oauth/")))) {
      if (url.origin === origin) smokeBlocked.add(url.pathname);
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
  // #2145: who signed in decides free or paid pictures; the session also lets a scheduled run delete its own ads.
  const auth = loginAuth(loginSession);
  // #2396: Create, Prepare and Picture need the identity; failing here reports it as sign-in, not as their own step.
  // Read-only runs (the post-deploy guard) don't use it, so they only note it.
  const identityProblem = auth ? null : `identity unreadable (${loginSessionProblem(loginSession)}) (#2396); no paid or free-quota request sent`;
  assert.ok(!identityProblem || !["--create", "--prepare", "--picture"].some((mode) => modes.has(mode)), identityProblem);
  if (identityProblem) console.log(`NOTE Sign in: ${identityProblem}`);
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
  // The saved draft of Prepare or Go live, as the owner (the route allows one DELETE of it).
  async function removeDraft(label, what) {
    if (!savedDraft) return;
    const draft = savedDraft;
    savedDraft = null;
    removingDraft = draft.id;
    draftDeleteCount = 0;
    const removed = await page.evaluate(async ({ id, version }) => {
      const result = await fetch(`/api/campaign-drafts/${id}?version=${version}`, { method: "DELETE" });
      return result.status;
    }, draft).catch(() => 0);
    if (removed === 200) console.log(`PASS Remove ${label}`);
    else {
      console.log(`FAIL Remove ${label}: HTTP ${removed}; remove ${what} from Saved drafts`);
      process.exitCode = 1;
    }
  }
  const viewsFailed = Boolean(process.exitCode);
  // --picture and --prepare skip the preflight Prepare: neither reads Meta's review.
  if (!modes.has("--campaign") && !modes.has("--picture") && !modes.has("--prepare")) {
    // Every deploy: Prepare one paused-campaign review, never send it, then delete its draft.
    const name = `QA preflight smoke ${crypto.randomUUID().slice(0, 8)}`;
    try {
      assert.equal(process.exitCode ?? 0, 0, "Read-only views failed; Prepare was not started");
      errors.length = 0;
      // Choosing the ad starts #497's background plan, so open the read-only setup allowances first (#531).
      const creative = await approvedAd(page);
      campaignSetup = true;
      await creative.click();
      await page.getByRole("textbox", { name: "Campaign name", exact: true }).fill(name);
      await page.locator("#budget").fill("350");
      // #1171: WhatsApp is the default destination; the smoke checks the (still supported) lead-form path.
      await page.locator("#destination-instant_form").check();
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
      // #1080 renders the facts as <dt>Meta account</dt><dd>Name, Page …</dd>: match the value, not "label: value".
      // While a blocker holds Send, the facts sit in a closed "What you're sending" <details>, so they are attached, not visible.
      await result.locator("dd").filter({ hasText: review.selected.accountName }).first().waitFor({ state: blockers.length ? "attached" : "visible" });
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
      await removeDraft("preflight draft", `"${name}"`);
    }

    // #2260: the pilot kit's one-tap Go live (#1271) saves its own draft and reviews it; #2257 failed only there.
    // Returning mode (`?again=1`) opens setup step 3 for an account that has had campaigns. Its plan, draft save
    // and preflight are allowed; the create and the activation stay blocked, so nothing reaches Meta.
    try {
      assert.ok(!viewsFailed, "Read-only views failed; Go live was not started");
      errors.length = 0;
      await page.goto(`${origin}/campaigns?again=1`);
      const tap = page.getByRole("button", { name: /^Go live · ₹300 a day$/ });
      await page.getByRole("group", { name: "Daily budget" }).getByRole("button", { name: "₹300 a day" }).click();
      await page.getByRole("group", { name: "How many days" }).getByRole("button", { name: "2 days" }).click();
      await tap.waitFor({ state: "visible" });
      planCount = 0;
      draftCount = 0;
      preflightCount = 0;
      savedDraft = null;
      goLiveSetup = true;
      const preflight = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/campaigns/preflight" && response.request().method() === "POST", { timeout: 90_000 });
      preflight.catch(() => undefined);
      await tap.click();
      const response = await preflight.catch(async (error) => {
        const alert = page.getByRole("alert").first();
        const message = await alert.isVisible() ? (await alert.innerText()).trim() : "";
        throw message ? new Error(`Go live stopped before its review: ${message}`) : error;
      });
      goLiveSetup = false;
      assert.equal(response.status(), 200, `Preflight returned HTTP ${response.status()}`);
      const review = (await response.json().catch(() => null))?.data;
      const blockers = review?.blockers ?? [];
      const unexpected = blockers.filter((blocker) => blocker.reason !== "REVIEW_NO_WEBSITE" && !blocker.message?.startsWith("Add your business website"));
      assert.equal(unexpected.length, 0, `Preflight blocked: ${unexpected.map((blocker) => blocker.reason ?? blocker.code).join(", ")}`);
      assert.ok(blockers.length || review?.canCreatePaused === true, "Preflight can't create the campaign paused, with no blocker named");
      console.log(`PASS Go live preflight (WhatsApp, ₹300 a day, 2 days; ${blockers.length ? "held only by the missing business website" : "ready to create paused"}; nothing sent to Meta)`);
    } catch (error) {
      console.log(`FAIL Go live preflight: ${error instanceof Error ? error.message.split("\n")[0].slice(0, 180) : "Unknown error"}; nothing sent to Meta`);
      process.exitCode = 1;
    } finally {
      goLiveSetup = false;
      await removeDraft("Go live draft", "the newest Go live draft");
    }
  }
  if (modes.has("--create")) {
    let savedCount = null;
    let createFailures = null;
    let explained = false;
    // #2504: one NOTE per missing ad and the run's failed attempts by reason, so a short run says why.
    async function explainShortRun() {
      if (explained) return;
      explained = true;
      let usage = null;
      const { businessId, generationId } = generationRequest ?? {};
      if (auth && UUID.test(businessId ?? "") && UUID.test(generationId ?? "")) {
        const rows = await supabaseFetch(auth, `/rest/v1/llm_usage_events?business_id=eq.${businessId}&metadata->>generationId=eq.${generationId}`
          + "&status=eq.error&select=usage_kind,provider,model,status,error_code,metadata&order=created_at").catch(() => null);
        if (rows?.ok) usage = await rows.json().catch(() => null);
      }
      for (const line of createFailureLines({ expected: 3, saved: savedCount, failures: createFailures, usage })) console.log(line);
    }
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
      // #2145: the smoke never buys pictures. The account must be internal and not exempt (`freeImagesOnly`).
      assert.ok(auth?.user?.id, "Signed-in identity unknown, so free pictures aren't certain; paid run was not started");
      assert.ok(makesFreePictures(auth.user), "This account would make paid pictures (not internal, or exempt); paid run was not started");
      errors.length = 0;
      assistantBusy.length = 0;
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
      // #2504: read the page's tee of the stream. Playwright's copy is a fallback only: Chrome can drop a long stream's
      // body before Playwright reads it (#1123: 131 s, "No data found for resource").
      const teed = await page.evaluate(() => window.__smokeCreateStream ?? null).catch(() => null);
      const create = teed == null ? await readCreateResponse(response).catch(() => null)
        : await createFromText(teed, response.status(), await response.headerValue("content-type"));
      createFailures = Array.isArray(create?.data?.failures) ? create.data.failures : null;
      savedCount = Array.isArray(create?.data?.creatives) ? create.data.creatives.length : null;
      if (create?.status !== 200 || savedCount !== 3) {
        savedCount = await recoverSavedCount();
      }
      assert.equal(generationCount, 1, "Paid Create request was blocked");
      if (create) assert.equal(create.status, 200, `Create returned HTTP ${create.status}`);
      else console.log(teed == null ? "NOTE Create stream body was not kept by the browser; counted the saved ads instead"
        : "NOTE Create stream ended without a result; counted the saved ads instead");
      if (savedCount !== 3) await explainShortRun();
      assert.equal(savedCount, 3, `Create saved ${savedCount}/3 ads; do not retry before checking saved work`);
      // #904 made "Review ads" a link, not a button (QA on #1227).
      await page.getByRole("link", { name: "Review ads", exact: true }).waitFor({ state: "visible" });
      const busy = forgiveRecoveredBusyTurns(errors, (await Promise.all(assistantBusy)).filter(Boolean).length);
      if (busy.note) console.log(busy.note);
      assert.equal(busy.errors.length, 0, busy.errors[0] ?? "Browser error after Create");
      // #2412: 3 saved ads can hide 2 reused pictures or a dead Cloudflare token; read where each picture came from.
      const { businessId, generationId } = generationRequest ?? {};
      assert.ok(UUID.test(businessId ?? "") && UUID.test(generationId ?? ""), "run ids unknown; pictures not checked");
      const runAds = await supabaseFetch(auth, `/rest/v1/creatives?business_id=eq.${businessId}&variant_group=eq.${generationId}&select=generation`);
      assert.ok(runAds.ok, `run's ads not read (HTTP ${runAds.status})`);
      const pictures = pictureSources(await runAds.json(), { expectCloudflare: process.env.SMOKE_EXPECT_CLOUDFLARE === "1" });
      console.log(pictures.line);
      assert.equal(pictures.failure, null, `Pictures: ${pictures.failure}`);
      console.log(`PASS Create: ${savedCount}/3 saved (free pictures, free text; $0)`);
      await cleanUpCreateRun();
    } catch (error) {
      if (generationCount && savedCount === null) savedCount = await recoverSavedCount();
      if (generationCount && savedCount !== 3) await explainShortRun().catch(() => {});
      console.log(`FAIL Create${generationCount ? `: ${savedCount ?? "unconfirmed"}/3 saved` : ""}: ${error instanceof Error ? error.message.split("\n")[0].slice(0, 180) : "Unknown error"}; ${generationCount ? "check saved work before any retry" : "no paid request sent"}`);
      process.exitCode = 1;
      // #2189: a failed run's saved ads stayed in the smoke workspace, and the repeat rules then checked every later
      // batch against them (12 near-identical headlines by 17:30Z), so each failure made the next one likelier.
      if (savedCount) await cleanUpCreateRun();
    }
  }
  if (modes.has("--prepare")) {
    // #2230: the scheduled Prepare check. Choosing an ad starts one audience plan; the smoke login's text is free
    // only (spend-policy `freeTextOnly`), so the plan comes from a free model or fails. Nothing is saved or sent to Meta.
    const since = new Date(Date.now() - 30_000).toISOString();
    try {
      assert.equal(process.exitCode ?? 0, 0, "Read-only views failed; no plan was requested");
      assert.ok(auth?.user?.id, "Signed-in identity unknown; no plan was requested");
      errors.length = 0;
      const creative = await approvedAd(page);
      const plan = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/campaigns/plan" && response.request().method() === "POST", { timeout: 90_000 });
      plan.catch(() => undefined);
      campaignSetup = true;
      await creative.click();
      const response = await plan;
      campaignSetup = false;
      const businessId = response.request().postDataJSON()?.audienceDraft?.businessId;
      const reply = await response.json().catch(() => null);
      assert.equal(response.status(), 200, `Plan returned HTTP ${response.status()}${reply?.code ? ` (${reply.code})` : ""}`);
      assert.ok(reply?.ready && reply.targeting, "Plan returned no targeting");
      assert.ok(UUID.test(businessId ?? ""), "Plan request named no business");
      const receipts = await supabaseFetch(auth, `/rest/v1/llm_usage_events?business_id=eq.${businessId}&route=eq.campaigns.plan`
        + `&created_at=gte.${encodeURIComponent(since)}&select=provider,model,status,error_code,estimated_cost_usd&order=created_at.asc`);
      assert.ok(receipts.ok, `AI receipts not read (HTTP ${receipts.status})`);
      const rows = await receipts.json();
      const quoted = rows.map((row) => `${row.provider} ${row.status}${row.error_code ? ` ${row.error_code}` : ""} $${row.estimated_cost_usd}`).join("; ");
      const answered = rows.find((row) => row.status === "success");
      assert.ok(answered, `No free model answered, so the plan fell back to default targeting (${quoted || "no AI calls recorded"})`);
      assert.ok(rows.every((row) => Number(row.estimated_cost_usd) === 0), `An AI call cost money: ${quoted}`);
      assert.equal(errors.length, 0, errors[0] ?? "Browser error during the plan");
      console.log(`PASS Prepare plan: ${answered.provider}/${answered.model}${reply.fallback ? " (default targeting kept)" : ""}; receipts: ${quoted}; nothing saved or sent to Meta`);
    } catch (error) {
      console.log(`FAIL Prepare plan: ${error instanceof Error ? error.message.split("\n")[0].slice(0, 300) : "Unknown error"}; nothing sent to Meta`);
      process.exitCode = 1;
    } finally {
      campaignSetup = false;
    }
  }
  if (modes.has("--picture")) {
    // #2145: the scheduled check. One new background (a template prompt, no text model) on a free picture provider.
    let before = null;
    let changed = false;
    try {
      assert.equal(process.exitCode ?? 0, 0, "Read-only views failed; no picture was requested");
      assert.ok(auth?.user?.id, "Signed-in identity unknown, so free pictures aren't certain; no picture was requested");
      assert.ok(makesFreePictures(auth.user), "This account would make paid pictures (not internal, or exempt); no picture was requested");
      // Never touch an ad in a campaign that reached Meta.
      const campaigns = await supabaseFetch(auth, "/rest/v1/campaigns?select=creative_ids&meta_campaign_id=not.is.null");
      assert.ok(campaigns.ok, `campaigns not read (HTTP ${campaigns.status})`);
      const live = new Set((await campaigns.json()).flatMap((campaign) => campaign.creative_ids ?? []));
      const recent = await supabaseFetch(auth, "/rest/v1/creatives?select=id,business_id,variant_group,image_url,generation&image_url=not.is.null&order=created_at.desc&limit=10");
      assert.ok(recent.ok, `ads not read (HTTP ${recent.status})`);
      const candidates = (await recent.json()).filter((ad) => UUID.test(ad.id) && !live.has(ad.id));
      assert.ok(candidates.length, "No ad to change; run --create once by hand (free text and pictures)");
      let result = null;
      const busy = [];
      for (const ad of candidates) {
        before = ad;
        pictureAllowed = ad.id;
        result = await page.evaluate(async ({ id, instruction }) => {
          const response = await fetch(`/api/creatives/${id}/background`, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ instruction }), signal: AbortSignal.timeout(330_000),
          });
          return { status: response.status, error: (await response.json().catch(() => null))?.error ?? null };
        }, { id: ad.id, instruction: BACKGROUND_INSTRUCTION });
        pictureAllowed = null;
        // 409: an earlier change to this ad is unfinished or held for a check; nothing was started, try the next ad.
        if (result.status !== 409) break;
        busy.push(ad.id.slice(0, 8));
        before = null;
      }
      assert.ok(before, `Every recent ad is held by an earlier unfinished change (${busy.join(", ")}); no picture was requested`);
      assert.equal(result.status, 200, `New background returned HTTP ${result.status}${result.error ? `: ${result.error}` : ""}`);
      changed = true;
      const saved = await supabaseFetch(auth, `/rest/v1/creatives?id=eq.${before.id}&select=generation`);
      assert.ok(saved.ok, `changed ad not read (HTTP ${saved.status})`);
      const image = (await saved.json())[0]?.generation?.image;
      assert.ok(FREE_PICTURES.includes(image?.provider), `Saved picture came from ${image?.provider ?? "an unknown provider"}, not a free one`);
      console.log(`PASS Picture: new background from ${image.provider}${image.latencyMs ? ` in ${Math.round(image.latencyMs / 1000)} s` : ""} (ad ${before.id.slice(0, 8)}${busy.length ? `; skipped ${busy.length} held` : ""}; no text model, $0)`);
    } catch (error) {
      pictureAllowed = null;
      console.log(`FAIL Picture: ${error instanceof Error ? error.message.split("\n")[0].slice(0, 180) : "Unknown error"}`);
      process.exitCode = 1;
    }
    if (changed) {
      try {
        const removed = await removeReplacedPictures(auth, before);
        console.log(removed ? `PASS Storage cleanup: deleted ${removed} replaced files`
          : "NOTE Storage cleanup: the replaced pictures are still referenced by an ad, so they were kept (#1891)");
      } catch (error) {
        console.log(`FAIL Storage cleanup: ${error instanceof Error ? error.message.split("\n")[0].slice(0, 180) : "Unknown error"}; the replaced pictures stay in Storage`);
        process.exitCode = 1;
      }
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
      await page.locator("#destination-instant_form").check();
      const form = page.locator("#leadform");
      const solarideForm = await form.locator("option").filter({ hasText: /solaride/i }).first().getAttribute("value");
      assert.ok(solarideForm, "No Solaride lead form; nothing created");
      await form.selectOption(solarideForm);
      campaignSetup = true;
      await page.getByRole("button", { name: "Check my campaign (nothing spends)" }).click();
      const review = page.getByRole("region", { name: "Campaign review result" });
      await review.getByRole("button", { name: "Send to Meta (paused)" }).waitFor({ state: "visible", timeout: 120_000 });
      assert.match(await review.innerText(), /(Meta )?account:?\s+Solaride\b/i, "Meta account is not Solaride; no campaign created");
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