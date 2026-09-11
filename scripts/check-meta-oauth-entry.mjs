import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";

assert.ok(["127.0.0.1", "localhost"].includes(new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname), "OAuth smoke requires local storage.");
const origin = "http://localhost:3939";
let cookies = [];
const auth = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  cookies: { getAll: () => [], setAll: updates => { cookies = updates.map(({ name, value }) => ({ name, value, domain: "localhost", path: "/", sameSite: "Lax" })); } },
});
const signedIn = await auth.auth.signInWithPassword({ email: process.env.DEV_LOGIN_EMAIL, password: process.env.DEV_LOGIN_PASSWORD });
assert.equal(signedIn.error, null);
const interactive = process.env.META_OAUTH_INTERACTIVE === "true";
const browser = await chromium.launch({ headless: !interactive });
try {
  const context = await browser.newContext();
  await context.addCookies(cookies);
  await context.route("**/api/**", route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.continue();
    if (route.request().method() === "GET" || url.pathname === "/api/meta/connections/start") return route.continue();
    return route.fulfill({ status: 403, json: { error: "Campaign and other mutations disabled during OAuth smoke." } });
  });
  const page = await context.newPage();
  await page.goto(`${origin}/settings`);
  await page.getByRole("button", { name: "Connect Business", exact: true }).click();
  const popupPromise = page.waitForEvent("popup");
  const startPromise = page.waitForResponse(response => new URL(response.url()).pathname === "/api/meta/connections/start" && response.request().method() === "POST");
  await page.getByRole("dialog").getByRole("button", { name: "Connect Business", exact: true }).click();
  const popup = await popupPromise;
  const started = await (await startPromise).json();
  assert.equal(started.ok, true, "Local OAuth attempt could not be started.");
  const callbackPromise = interactive ? context.waitForEvent("requestfinished", {
    predicate: request => new URL(request.url()).origin === origin && new URL(request.url()).pathname === "/api/meta/oauth/callback",
    timeout: 600000,
  }) : null;
  await popup.waitForURL(url => url.hostname.endsWith("facebook.com"), { timeout: 30000 });
  await popup.waitForLoadState("domcontentloaded");
  await expect(popup.locator("body")).toBeVisible();
  if (interactive) {
    console.log("Meta login is open in a visible browser. Sign in there; waiting for the local OAuth callback.");
    await callbackPromise;
    const response = await context.request.get(`${origin}/api/meta/connections/attempts/${encodeURIComponent(started.data.attemptId)}`);
    const result = await response.json();
    console.log(JSON.stringify({ consentCompleted: result.ok && result.data?.state === "connected", attemptState: result.data?.state,
      discoveryComplete: result.data?.discoveryComplete, candidateCount: result.data?.candidates?.length,
      blockerCodes: result.data?.blockers?.map(blocker => blocker.code), campaignMutations: 0 }, null, 2));
  } else {
    const text = (await popup.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 1600);
    console.log(JSON.stringify({ providerOrigin: new URL(popup.url()).origin, entryText: text, consentCompleted: false, campaignMutations: 0 }, null, 2));
  }
} finally { await browser.close(); }