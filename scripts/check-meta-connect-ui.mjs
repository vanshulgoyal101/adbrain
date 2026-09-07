import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createServerClient } from "@supabase/ssr";
import { chromium, expect } from "@playwright/test";

const baseUrl = process.env.META_CONNECT_UI_BASE_URL ?? "http://localhost:3939";
if (new URL(baseUrl).hostname !== "localhost") throw new Error("Meta browser checks are restricted to localhost.");
const outputDir = join(process.cwd(), "test-results", "meta-connect-w3");
const businessId = "11111111-1111-4111-8111-111111111111";
const attemptId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const campaignId = "44444444-4444-4444-8444-444444444444";
const checkedAt = "2026-09-07T00:00:00.000Z";

const assets = {
  metaBusinessId: "meta-business-1",
  adAccountId: "act_123456",
  accountName: "Growth account",
  pageId: "page-123",
  pageName: "Vanshul Clinic",
  currency: "INR",
  timezoneName: "Asia/Kolkata",
};

const unknownCapabilities = {
  canReadInsights: { state: "unknown", blockers: [] },
  canReadLeads: { state: "unknown", blockers: [] },
  canCreatePaused: { state: "unknown", blockers: [] },
  canActivate: { state: "unknown", blockers: [] },
};

const disconnected = {
  businessId,
  generation: 0,
  authorization: "disconnected",
  selected: null,
  capabilities: unknownCapabilities,
  checkedAt: null,
};

const connected = {
  businessId,
  generation: 3,
  authorization: "connected",
  selected: assets,
  capabilities: {
    canReadInsights: { state: "available", blockers: [] },
    canReadLeads: { state: "available", blockers: [] },
    canCreatePaused: { state: "available", blockers: [] },
    canActivate: { state: "available", blockers: [] },
  },
  checkedAt,
};

const connectedAttempt = {
  attemptId,
  businessId,
  intent: { kind: "review_activation", campaignId },
  expiresAt: "2026-09-08T00:00:00.000Z",
  revision: 2,
  state: "connected",
  discoveryComplete: true,
  candidates: [],
  connection: connected,
  blockers: [],
  retryAfterMs: null,
};

function apiSuccess(data) {
  return { ok: true, data, requestId };
}

function apiFailure(message) {
  return {
    ok: false,
    error: { code: "UNAVAILABLE", message, retryable: true },
    requestId,
  };
}

async function signInCookies() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const email = process.env.DEV_LOGIN_EMAIL;
  const password = process.env.DEV_LOGIN_PASSWORD;
  if (!url || !key || !email || !password) {
    throw new Error(
      "Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, DEV_LOGIN_EMAIL, and DEV_LOGIN_PASSWORD for the authenticated browser check.",
    );
  }

  let cookies = [];
  const client = createServerClient(url, key, {
    cookies: {
      getAll: () => [],
      setAll: (updates) => {
        cookies = updates.map(({ name, value }) => ({
          name,
          value,
          url: baseUrl,
        }));
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error("Local browser-test account sign-in failed.");
  return cookies;
}

async function mockConnectionApi(page) {
  const calls = [];
  const unexpected = [];
  let attemptMode = "authorizing";

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const call = { method: request.method(), path: url.pathname };
    calls.push(call);

    if (request.method() === "GET" && url.pathname === "/api/meta/connections/status") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(apiSuccess(disconnected)),
      });
      return;
    }

    if (request.method() === "POST" && url.pathname === "/api/meta/connections/start") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(apiSuccess({
          attemptId,
          authorizationUrl: `${baseUrl}/connect/meta/waiting?attemptId=${attemptId}`,
          expiresAt: "2026-09-08T00:00:00.000Z",
        })),
      });
      return;
    }

    if (request.method() === "GET" && url.pathname === `/api/meta/connections/attempts/${attemptId}`) {
      const data = attemptMode === "connected"
        ? connectedAttempt
        : {
            ...connectedAttempt,
            intent: { kind: "setup" },
            state: "authorizing",
            connection: null,
            discoveryComplete: false,
          };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(apiSuccess(data)),
      });
      return;
    }

    if (request.method() === "POST" && url.pathname === `/api/meta/connections/attempts/${attemptId}/select`) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(apiSuccess(connectedAttempt)),
      });
      return;
    }

    unexpected.push(call);
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify(apiFailure(`Unexpected browser request: ${request.method()} ${url.pathname}`)),
    });
  });

  return {
    calls,
    unexpected,
    setConnected() {
      attemptMode = "connected";
    },
  };
}

async function assertNoUnexpectedMutations(state) {
  expect(state.unexpected).toEqual([]);
  expect(state.calls.some(({ path }) => /campaign-drafts|campaigns\/(create|activate)|creatives\/generate/.test(path))).toBe(false);
}

async function assertResponsive(page, width, name = "meta-connect") {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({
    path: join(outputDir, `${name}-${width}.png`),
    fullPage: true,
  });
}

async function runResponsiveScreenshots(context) {
  let authenticatedSurfaceAvailable = true;
  for (const width of [1440, 1024, 768, 390]) {
    const page = await context.newPage();
    const state = await mockConnectionApi(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${baseUrl}/settings`);
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    const connectButton = page.getByRole("button", { name: "Connect Business" });
    if (await connectButton.count() === 0) {
      await expect(page.getByText(/Meta connection status is temporarily unavailable/i)).toBeVisible();
      await assertResponsive(page, width, "settings-unavailable");
      authenticatedSurfaceAvailable = false;
      await page.close();
      continue;
    }
    await expect(connectButton).toBeVisible();
    await assertResponsive(page, width);
    await page.getByRole("button", { name: "Connect Business" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Connect your business to Meta" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Connect Business" })).toBeFocused();
    await assertNoUnexpectedMutations(state);
    await page.close();
  }
  return authenticatedSurfaceAvailable;
}

async function runStaticRouteChecks(context) {
  for (const width of [1440, 1024, 768, 390]) {
    const page = await context.newPage();
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${baseUrl}/connect/meta/waiting`);
    await expect(page.getByRole("heading", { name: "Continue in the Meta window" })).toBeVisible();
    await assertResponsive(page, width, "waiting");
    await page.goto(`${baseUrl}/connect/meta/complete?attemptId=not-a-uuid`);
    await expect(page.getByRole("heading", { name: "Connection needs attention" })).toBeVisible();
    await assertResponsive(page, width, "completion-error");
    await page.close();
  }
}

async function runPopupAndMessageChecks(context) {
  const page = await context.newPage();
  const state = await mockConnectionApi(page);
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto(`${baseUrl}/settings`);
  await page.getByRole("button", { name: "Connect Business" }).click();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("dialog").getByRole("button", { name: "Connect Business" }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();

  await popup.evaluate(() => {
    window.opener?.postMessage(
      { type: "adbrain.meta.complete", attemptId: "stale-attempt" },
      window.location.origin,
    );
  });
  await page.evaluate(() => {
    window.dispatchEvent(new MessageEvent("message", {
      origin: "https://untrusted.example",
      source: window,
      data: { type: "adbrain.meta.complete", attemptId: "22222222-2222-4222-8222-222222222222" },
    }));
  });
  await expect(page.getByRole("dialog")).toBeVisible();

  state.setConnected();
  await popup.evaluate((id) => {
    window.opener?.postMessage(
      { type: "adbrain.meta.complete", attemptId: id },
      window.location.origin,
    );
  }, attemptId);
  await page.waitForLoadState("domcontentloaded").catch(() => undefined);
  await assertNoUnexpectedMutations(state);
  await popup.close();
  await page.close();
}

async function runPopupBlockedCheck(context) {
  const page = await context.newPage();
  const state = await mockConnectionApi(page);
  await page.addInitScript(() => {
    window.open = () => null;
  });
  await page.goto(`${baseUrl}/settings`);
  await page.getByRole("button", { name: "Connect Business" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Connect Business" }).click();
  await expect(page).toHaveURL(/\/connect\/meta\/waiting\?attemptId=/);
  await assertNoUnexpectedMutations(state);
  await page.close();
}

async function bootstrapAuthentication(context) {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/auth/dev-login`);
  const redirectedToLogin = new URL(page.url()).pathname === "/login";
  await page.close();
  if (!redirectedToLogin) return;

  const cookies = await signInCookies();
  await context.addCookies(cookies);
}

async function main() {
  mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  try {
    await runStaticRouteChecks(context);
    if (process.env.META_CONNECT_UI_STATIC_ONLY === "true") {
      console.log(`Worker 3 static browser checks passed. Screenshots: ${outputDir}`);
      return;
    }
    await bootstrapAuthentication(context);
    const authenticatedSurfaceAvailable = await runResponsiveScreenshots(context);
    if (!authenticatedSurfaceAvailable) {
      console.log(`Worker 3 static browser checks passed; authenticated dialog matrix skipped because Meta connection storage is unavailable. Screenshots: ${outputDir}`);
      process.exitCode = 2;
      return;
    }
    await runPopupAndMessageChecks(context);
    await runPopupBlockedCheck(context);
    console.log(`Worker 3 Meta Connect browser checks passed. Screenshots: ${outputDir}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
