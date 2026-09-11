import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import JSZip from "jszip";

const origin = "https://adbrain.vanshul.com";
const liveGeneration = process.argv.includes("--live-generation");
const approvalRoundTrip = process.argv.includes("--approval-roundtrip");
const reviewId = process.argv.find((argument) => argument.startsWith("--review-id="))?.split("=")[1];
assert.ok(!approvalRoundTrip || /^[0-9a-f-]{36}$/.test(reviewId ?? ""), "Approval testing requires the exact authorized test creative ID.");
const livePermit = fileURLToPath(new URL("../.creative-evals/demo-live-2026-09-11-one-ad.json", import.meta.url));
const output = fileURLToPath(new URL(`../.creative-evals/demo-${new Date().toISOString().replace(/[:.]/g, "-")}/`, import.meta.url));
const email = process.env.DEMO_USER_EMAIL ?? "demo@adbrain.vanshul.com";
const password = process.env.DEMO_USER_PASSWORD;
assert.ok(password, "DEMO_USER_PASSWORD is required; never enter it in chat.");
const report = {
  startedAt: new Date().toISOString(),
  origin,
  liveGeneration,
  login: null,
  routes: [],
  browserErrors: [],
  failedReads: [],
  failedRequests: [],
  blockedActions: [],
  generation: null,
  interview: [],
  interactions: [],
  publicRoutes: [],
  export: null,
};
await mkdir(output, { recursive: true, mode: 0o700 });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
context.setDefaultTimeout(15_000);
context.setDefaultNavigationTimeout(45_000);
let loginRequests = 0;
let generationRequests = 0;
let generationArmed = false;
let interviewRequests = 0;
let approvalArmed = null;
let approvalRequests = 0;
let exportArmed = false;

await context.route("**/*", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const method = request.method();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) {
    if (url.origin === origin && (["/api/meta/oauth/start", "/api/meta/oauth/callback", "/auth/dev-login"].includes(url.pathname) || url.pathname.startsWith("/api/scheduler"))) {
      report.blockedActions.push({ method, path: url.pathname });
      return route.abort("blockedbyclient");
    }
    return route.continue();
  }
  if (url.hostname.endsWith(".supabase.co") && url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password" && loginRequests++ === 0) {
    return route.continue();
  }
  if (approvalRoundTrip && approvalArmed && approvalRequests < 2 && url.origin === origin && url.pathname === "/studio" && method === "POST" && request.headers()["next-action"]) {
    const body = request.postData() ?? "";
    assert.ok(body.includes(reviewId) && body.includes(`"${approvalArmed}"`), "Only the authorized test creative's approval state may change.");
    approvalArmed = null;
    approvalRequests += 1;
    return route.continue();
  }
  if (exportArmed && url.origin === origin && url.pathname === "/api/creatives/export" && method === "POST") {
    exportArmed = false;
    return route.continue();
  }
  if (liveGeneration && url.origin === origin && url.pathname === "/api/creatives/assistant" && method === "POST" && interviewRequests < 3) {
    interviewRequests += 1;
    return route.continue();
  }
  if (generationArmed && liveGeneration && url.origin === origin && url.pathname === "/api/creatives/generate" && method === "POST") {
    const input = request.postDataJSON();
    assert.equal(generationRequests, 0, "A second generation request is forbidden.");
    const receipt = { startedAt: new Date().toISOString(), requestedCount: input.count, transmittedCount: 1, businessId: input.businessId };
    try {
      await writeFile(livePermit, JSON.stringify(receipt), { flag: "wx", mode: 0o600 });
    } catch {
      report.blockedActions.push({ method, path: url.pathname, reason: "Single-generation approval has already been consumed." });
      return route.abort("blockedbyclient");
    }
    generationRequests += 1;
    generationArmed = false;
    report.generation = { ...receipt, state: "requested", output };
    console.log("Authorized production generation submitted once (count=1; no retries).");
    return route.continue({ postData: JSON.stringify({ ...input, count: 1 }) });
  }
  report.blockedActions.push({ method, host: url.hostname, path: url.pathname });
  return route.abort("blockedbyclient");
});

const page = await context.newPage();
page.on("pageerror", (error) => report.browserErrors.push(error.message.slice(0, 240)));
page.on("response", (response) => {
  const url = new URL(response.url());
  if (response.request().method() === "GET" && response.status() >= 400) {
    report.failedReads.push({ status: response.status(), path: url.pathname });
  }
});
page.on("requestfailed", (request) => {
  if (request.method() !== "GET") return;
  const url = new URL(request.url());
  report.failedRequests.push({ host: url.hostname, path: url.pathname, reason: request.failure()?.errorText });
});

async function settleImages() {
  return page.locator("main img").evaluateAll(async (images) => {
    for (const image of images) image.loading = "eager";
    await Promise.all(images.map((image) => new Promise((resolve) => {
      if (image.complete) return resolve();
      const timer = setTimeout(finish, 20_000);
      function finish() {
        clearTimeout(timer);
        image.removeEventListener("load", finish);
        image.removeEventListener("error", finish);
        resolve();
      }
      image.addEventListener("load", finish, { once: true });
      image.addEventListener("error", finish, { once: true });
    })));
    return images.map((image) => ({
      loaded: image.complete && image.naturalWidth > 0,
      pending: !image.complete,
      width: image.naturalWidth,
      height: image.naturalHeight,
      source: image.currentSrc || image.src,
    }));
  });
}

async function capture(name) {
  await page.locator("main img").evaluateAll((images) => images.forEach((image) => { image.loading = "eager"; }));
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: `${output}${name}.png`, fullPage: await page.getByRole("dialog").count() === 0, animations: "disabled" });
}

async function navigate(path) {
  try {
    return await page.goto(`${origin}${path}`, { waitUntil: "domcontentloaded" });
  } catch (error) {
    if (!/ERR_TIMED_OUT|ERR_NETWORK_IO_SUSPENDED/.test(String(error))) throw error;
    report.interactions.push({ step: "Read-only navigation retry", path, warning: "One transient navigation failure; no action resubmitted." });
    return page.goto(`${origin}${path}`, { waitUntil: "domcontentloaded" });
  }
}

async function signIn() {
  await page.goto(`${origin}/login`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  const authResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/auth/v1/token" && response.request().method() === "POST");
  await page.getByRole("button", { name: "Sign in with password", exact: true }).click();
  const response = await authResponse;
  report.login = { status: response.status(), completed: false };
  assert.equal(response.status(), 200, "Demo sign-in failed. Response payload is intentionally not logged.");
  await page.waitForURL((url) => url.origin === origin && !url.pathname.startsWith("/login"), { waitUntil: "load", timeout: 45_000 });
  report.login.completed = true;
  console.log("Production demo sign-in: PASS (real browser session).");
}

async function walkthrough() {
  for (const width of process.argv.includes("--images-only") ? [1440] : [1440, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    const paths = process.argv.includes("--images-only") ? ["/studio", "/brand"]
      : process.argv.includes("--review-only") ? ["/studio", "/campaigns"]
        : ["/dashboard", "/brand", "/create", "/studio", "/assets", "/campaigns", "/leads", "/settings"];
    for (const path of paths) {
      const response = await navigate(path);
      await page.locator("h1").first().waitFor({ state: "visible" });
      const images = await settleImages();
      const result = {
        path,
        width,
        status: response?.status(),
        actualPath: new URL(page.url()).pathname,
        headings: await page.locator("h1,h2").allTextContents(),
        errorPage: await page.getByText("Something went wrong", { exact: true }).count() > 0,
        overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
        alerts: await page.getByRole("alert").allTextContents(),
        images,
      };
      report.routes.push(result);
      await capture(`${path.slice(1)}-${width}`);
      console.log(`${width}px ${path}: HTTP ${result.status}, ${result.errorPage ? "ERROR PAGE" : "rendered"}, overflow=${result.overflow}, loaded images=${result.images.filter((image) => image.loaded).length}/${result.images.length}`);
      assert.equal(result.status, 200, `${path}: route failed`);
      assert.equal(result.actualPath, path, `${path}: unexpected redirect`);
      assert.equal(result.errorPage, false, `${path}: error page`);
      assert.equal(result.overflow, false, `${path}: horizontal overflow at ${width}px`);
      assert.ok(result.images.every((image) => image.loaded), `${path}: images did not load`);
      if (!process.argv.includes("--images-only")) {
        try {
          await testInteractions(path, width);
        } catch (error) {
          const message = error instanceof Error ? error.message.slice(0, 500) : "Interaction failed.";
          report.interactions.push({ step: "Interaction failure", path, width, message, passed: false });
          console.error(`${width}px ${path}: ${message}`);
          process.exitCode = 1;
        }
      }
    }
  }
}

async function testInteractions(path, width) {
  if (path === "/brand") {
    const fields = await page.locator("main input:not([type=checkbox]):not([type=file]), main textarea").evaluateAll((elements) => elements.map((element) => ({ name: element.name || element.id, filled: element.value.trim().length > 0 })));
    report.interactions.push({ step: "Saved Brand Brain", width, fields, savedChanges: false });
  }
  if (path === "/create") {
    const goal = page.getByRole("textbox", { name: "Campaign goal", exact: true });
    const draft = "Customer demo: invite local enquiries\nUse saved business facts only.";
    await goal.fill(draft);
    await page.getByRole("heading", { name: "What would you like to achieve?" }).click();
    await navigate("/assets");
    await navigate("/create");
    await expect(goal).toHaveValue(draft);
    report.interactions.push({ step: "Interview goal survives navigation", width, passed: true, paidRequest: false });
  }
  if (path === "/studio") {
    const inspector = page.getByRole("region", { name: "Creative inspector" });
    const preview = inspector.getByTitle("Enlarge creative", { exact: true });
    await preview.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Close preview", exact: true })).toBeFocused();
    await capture(`preview-${width}`);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(preview).toBeFocused();
    const search = page.getByRole("searchbox", { name: "Search creatives" });
    await search.fill("no-match-demo-rehearsal-20260911");
    await expect(page.getByRole("heading", { name: "No matching creatives" })).toBeVisible();
    await page.getByRole("button", { name: "Clear filters", exact: true }).click();
    await page.getByRole("radio", { name: /^Approved/ }).check();
    await expect(inspector).toBeVisible();
    report.interactions.push({ step: "Review search, approved filter, preview, keyboard and Escape", width, passed: true });
    if (width === 1440 && !process.argv.includes("--review-only")) {
      exportArmed = true;
      const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/creatives/export", { timeout: 90_000 });
      const downloadPromise = page.waitForEvent("download", { timeout: 90_000 });
      await page.getByRole("button", { name: /^Export approved/ }).click();
      const response = await responsePromise;
      assert.equal(response.status(), 200);
      const download = await downloadPromise;
      const destination = `${output}approved-ad-pack.zip`;
      await download.saveAs(destination);
      const bytes = await readFile(destination);
      const archive = await JSZip.loadAsync(bytes);
      const entries = Object.keys(archive.files).filter((name) => !archive.files[name].dir);
      assert.ok(entries.includes("copy.txt") && entries.some((name) => /\.(png|jpe?g)$/.test(name)));
      report.export = { status: response.status(), bytes: bytes.length, entries, imagesSkipped: response.headers()["x-images-skipped"], path: destination };
      console.log(`Approved export: HTTP ${response.status()}, ${entries.length} files, ${bytes.length} bytes, skipped=${report.export.imagesSkipped}.`);
    }
    await page.getByText("New creative brief", { exact: true }).click();
    await page.getByLabel("Variants", { exact: true }).selectOption("1");
    await page.getByLabel("Placement", { exact: true }).selectOption("portrait");
    await page.getByLabel("What are we advertising?", { exact: true }).fill("Introduce Cedar Ridge Chiropractic to local customers using only the saved Brand Brain facts.");
    await expect(page.getByRole("button", { name: "Generate ads", exact: true })).toBeEnabled();
    await capture(`one-variant-setup-${width}`);
    report.interactions.push({ step: "Single-variant Studio controls", width, passed: true, generationSubmitted: false, count: 1, format: "portrait" });
    await page.getByText("New creative brief", { exact: true }).click();
  }
  if (path === "/campaigns") {
    const open = page.getByRole("button", { name: "New campaign", exact: true });
    if (await open.count()) await open.click();
    const name = page.getByRole("textbox", { name: "Campaign name", exact: true });
    if (await name.count()) {
      await name.fill("Demo review only - do not create");
      await page.getByRole("spinbutton", { name: "Daily budget (₹)", exact: true }).fill("200");
      await page.getByRole("checkbox", { name: /A\/B test the audience/ }).check();
      await expect(page.getByText("₹400/day", { exact: true }).first()).toBeVisible();
      const forms = await page.locator("#leadform option").allTextContents();
      await page.getByRole("radio", { name: "Plan with AdBrain", exact: true }).check();
      await page.getByRole("radio", { name: "Choose settings", exact: true }).check();
      await expect(name).toHaveValue("Demo review only - do not create");
      await page.locator("#campaign-composer button[aria-pressed]").first().click();
      await expect(page.getByRole("button", { name: "Prepare campaign review", exact: true })).toBeEnabled();
      await settleImages();
      await capture(`campaign-review-${width}`);
      await page.getByRole("button", { name: "Close campaign setup", exact: true }).click();
      await open.click();
      await expect(page.getByRole("radio", { name: "Choose settings", exact: true })).toBeChecked();
      await expect(name).not.toHaveValue("Demo review only - do not create");
      await expect(page.getByRole("checkbox", { name: /A\/B test the audience/ })).not.toBeChecked();
      report.interactions.push({ step: "Campaign selection, A/B total, mode retention and new-campaign reset", width, passed: true, selectedCount: 1, effectiveDailyBudgetINR: 400, formCount: forms.length, forms, prepared: false, created: false, activated: false });
    } else {
      report.interactions.push({ step: "Campaign composer", width, passed: false, reason: "Connection or approved creative prerequisites unavailable." });
    }
  }
  if (path === "/leads") {
    const search = page.getByRole("searchbox", { name: "Search enquiries" });
    if (await search.count()) {
      await search.fill("no-demo-contact-match");
      await page.getByRole("button", { name: "Clear filters", exact: true }).click();
      await expect(search).toHaveValue("");
    }
    report.interactions.push({ step: "Enquiries", width, heading: await page.locator("h2").allTextContents(), syncExecuted: false });
  }
  if (path === "/settings") {
    report.interactions.push({ step: "Settings", width, serverManagedConnection: await page.getByText(/Connected using server credentials/).count() > 0, noWeeklyCap: await page.getByText(/No weekly cap is set/).count() > 0, savedChanges: false });
    if (width < 768) {
      const trigger = page.getByRole("button", { name: "Open navigation", exact: true });
      await trigger.click();
      const menu = page.getByRole("dialog", { name: "Workspace menu", exact: true });
      await expect(menu).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(menu).not.toBeVisible();
      await expect(trigger).toBeFocused();
      await trigger.click();
      await menu.getByRole("link", { name: "Enquiries", exact: true }).click();
      await page.waitForURL("**/leads", { waitUntil: "domcontentloaded" });
      await expect(menu).not.toBeVisible();
      report.interactions.push({ step: "Mobile menu navigation, Escape and return focus", width, passed: true });
    }
  }
}

async function testApprovalRoundTrip() {
  await page.goto(`${origin}/studio?creative=${encodeURIComponent(reviewId)}`, { waitUntil: "load" });
  const inspector = page.getByRole("region", { name: "Creative inspector" });
  const approve = inspector.getByRole("button", { name: "Approve", exact: true });
  await expect(approve).toBeVisible();
  let approved = false;
  try {
    approvalArmed = "approved";
    await approve.click();
    const unapprove = inspector.getByRole("button", { name: /^(Unapprove|Approved)/ });
    await expect(unapprove).toBeVisible();
    approved = true;
    await page.reload({ waitUntil: "load" });
    await expect(unapprove).toBeVisible();
    report.interactions.push({ step: "Approve new test creative and verify persistence", passed: true, creativeId: reviewId });
  } finally {
    if (approved) {
      approvalArmed = "draft";
      await inspector.getByRole("button", { name: /^(Unapprove|Approved)/ }).click();
      await expect(approve).toBeVisible();
      await page.reload({ waitUntil: "load" });
      await expect(approve).toBeVisible();
      report.interactions.push({ step: "Restore test creative to draft and verify persistence", passed: true, creativeId: reviewId });
      console.log("Approval round trip: PASS; test creative restored to draft.");
    }
  }
}

async function generateOneAd() {
  await page.goto(`${origin}/create`, { waitUntil: "load" });
  const goal = "Introduce Cedar Ridge Chiropractic to adults in Austin, Texas. Invite enquiries about our services and appointment availability. Use only saved brand facts, with no new offers, guarantees, or personal health claims. Use English.";
  await page.getByRole("textbox", { name: "Campaign goal", exact: true }).fill(goal);
  generationArmed = true;
  const generationResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/creatives/generate" && response.request().method() === "POST", { timeout: 360_000 })
    .then(async (response) => ({ status: response.status(), payload: await response.json().catch(() => null) }))
    .catch(() => null);
  const started = Date.now();
  const progress = setInterval(() => console.log(`Live creative check: ${Math.round((Date.now() - started) / 1000)}s elapsed; no resubmission.`), 20_000);
  try {
    let action = () => page.getByRole("button", { name: "Start creating", exact: false }).click();
    for (let turn = 0; turn < 3; turn += 1) {
      const reply = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/creatives/assistant" && response.request().method() === "POST", { timeout: 90_000 });
      await action();
      const response = await reply;
      const payload = await response.json().catch(() => null);
      report.interview.push({ status: response.status(), ready: payload?.ready === true, question: payload?.question?.question, error: payload?.error });
      console.log(`Interview ${turn + 1}: HTTP ${response.status()}, ready=${payload?.ready === true}, question=${payload?.question?.question ?? "none"}`);
      if (!response.ok() || payload?.ready || !payload?.question || turn === 2) break;
      const custom = page.getByPlaceholder("…or type your own answer", { exact: true });
      await custom.waitFor({ state: "visible" });
      const question = payload.question.question.toLowerCase();
      const answer = /action|cta|take|book|click/.test(question)
        ? "Invite people to learn about our services and request an appointment. Use a Book Now call to action. Use English and only the offers already saved in Brand Brain."
        : "Adults aged 30-60 in Austin, Texas, including local office workers and families. Introduce the clinic with a calm professional tone and invite appointment enquiries. Use English and saved brand facts only; avoid personal health claims and guarantees.";
      await custom.fill(answer);
      action = () => custom.press("Enter");
    }
    if (report.interview.at(-1)?.ready !== true) {
      report.generation = { state: "not_submitted", reason: "Interview did not produce a brief within the three-call approval." };
      generationArmed = false;
      return;
    }
    const response = await generationResponse;
    report.generation = {
      ...report.generation,
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
      state: response?.payload?.creatives?.length ? "saved" : "failed_or_unknown",
      status: response?.status ?? null,
      error: response?.payload?.error ?? null,
      creatives: response?.payload?.creatives ?? [],
      failures: response?.payload?.failures ?? [],
    };
    await capture("live-generation-result");
    if (report.generation.creatives.length) {
      const creative = report.generation.creatives[0];
      assert.equal(creative.status, "draft", "The test creative must remain a draft.");
      await page.goto(`${origin}/studio?creative=${encodeURIComponent(creative.id)}`, { waitUntil: "load" });
      await page.getByRole("region", { name: "Creative inspector" }).getByRole("heading", { name: creative.headline, exact: true }).waitFor();
      report.generation.reloadedImages = await settleImages();
      await capture("live-generation-persisted");
      console.log(`Generation saved: HTTP ${response.status}, ${report.generation.elapsedSeconds}s, ${report.generation.creatives.length} draft; persisted headline found after reload.`);
    } else {
      console.log(`Generation did not return a saved creative: HTTP ${response?.status ?? "network/timeout"}, ${report.generation.elapsedSeconds}s, error=${report.generation.error ?? "unknown"}. No retry sent.`);
      process.exitCode = 1;
    }
  } finally {
    clearInterval(progress);
  }
}

try {
  if (!liveGeneration) {
    for (const path of ["/", "/login", "/privacy", "/terms", "/data-deletion", "/robots.txt", "/sitemap.xml", "/manifest.webmanifest"]) {
      const response = await context.request.get(`${origin}${path}`);
      report.publicRoutes.push({ path, status: response.status() });
      assert.equal(response.status(), 200, `Public route failed: ${path}`);
    }
  }
  await signIn();
  if (approvalRoundTrip) await testApprovalRoundTrip();
  if (liveGeneration) await generateOneAd();
  else await walkthrough();
  assert.equal(report.browserErrors.length, 0, "Browser runtime errors were recorded.");
  assert.equal(report.failedReads.length, 0, "Failed HTTP reads were recorded.");
  assert.ok(report.interactions.every((interaction) => interaction.passed !== false), "An interaction check failed.");
} catch (error) {
  report.failure = error instanceof Error ? error.message.slice(0, 600) : "Production rehearsal failed.";
  process.exitCode = 1;
  console.error(report.failure);
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(`${output}report.json`, JSON.stringify(report, null, 2), { mode: 0o600 });
  await context.close();
  await browser.close();
  console.log(`Evidence: ${output}`);
}