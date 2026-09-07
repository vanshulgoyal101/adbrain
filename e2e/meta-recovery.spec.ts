import { test, expect } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { buildAttemptBlockers } from "../src/lib/meta/attempt-recovery";

for (const width of [1440, 390]) {
  test(`missing access recovers to explicit asset selection at ${width}px`, async ({ page, context }, testInfo) => {
    const databaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    expect(["localhost", "127.0.0.1"]).toContain(new URL(databaseUrl).hostname);
    let cookies: Parameters<typeof context.addCookies>[0] = [];
    const auth = createServerClient(databaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: { getAll: () => [], setAll: updates => { cookies = updates.map(({ name, value }) => ({ name, value, domain: "localhost", path: "/", sameSite: "Lax" })); } },
    });
    expect((await auth.auth.signInWithPassword({ email: process.env.DEV_LOGIN_EMAIL!, password: process.env.DEV_LOGIN_PASSWORD! })).error).toBeNull();
    await context.addCookies(cookies);
    await page.setViewportSize({ width, height: 900 });
    const businessId = "11111111-1111-4111-8111-111111111111";
    const attemptId = "22222222-2222-4222-8222-222222222222";
    const requestId = "33333333-3333-4333-8333-333333333333";
    const capability = { state: "unknown", blockers: [] };
    const connection = { businessId, generation: 0, authorization: "disconnected", selected: null, checkedAt: null,
      capabilities: { canReadInsights: capability, canReadLeads: capability, canCreatePaused: capability, canActivate: capability } };
    const candidates = ["First", "Second"].map((name, index) => ({ pairId: `pair-${index}`, eligible: true, blockers: [],
      assets: { metaBusinessId: null, adAccountId: `act_${index + 1}`, accountName: `${name} account`, pageId: `page-${index}`, pageName: `${name} Page`, currency: "INR", timezoneName: "Asia/Kolkata" } }));
    let selected = false;
    let retried = false;
    const unexpected: string[] = [];
    const blockers = buildAttemptBlockers({ state: "action_required", errorCode: "SETUP_REQUIRED", discoveryComplete: true, snapshot: { adAccounts: [], pages: [] }, candidates: [] });
    const attempt = () => ({ attemptId, businessId, intent: { kind: "setup" }, expiresAt: "2099-01-01T00:00:00.000Z",
      state: selected ? "connected" : retried ? "selection_required" : "action_required", revision: selected ? 3 : retried ? 2 : 1,
      discoveryComplete: true, candidates: retried ? candidates : [], blockers: retried ? [] : blockers, retryAfterMs: null,
      connection: selected ? { ...connection, generation: 1, authorization: "connected", selected: candidates[1].assets } : null });
    const ok = (data: unknown) => ({ ok: true, data, requestId });
    await context.route("**/api/**", async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/api/meta/connections/status" && request.method() === "GET") return route.fulfill({ json: ok(selected ? attempt().connection : connection) });
      if (path === "/api/meta/connections/start" && request.method() === "POST") return route.fulfill({ json: ok({ attemptId, authorizationUrl: "http://localhost:3939/connect/meta/waiting", expiresAt: "2099-01-01T00:00:00.000Z" }) });
      if (path === `/api/meta/connections/attempts/${attemptId}` && request.method() === "GET") return route.fulfill({ json: ok(attempt()) });
      if (path === `/api/meta/connections/attempts/${attemptId}/retry` && request.method() === "POST") {
        expect(request.postDataJSON()).toMatchObject({ revision: 1 });
        retried = true;
        return route.fulfill({ json: ok(attempt()) });
      }
      if (path === `/api/meta/connections/attempts/${attemptId}/select` && request.method() === "POST") {
        expect(request.postDataJSON()).toMatchObject({ pairId: "pair-1", revision: 2, confirmReplacement: false });
        selected = true;
        return route.fulfill({ json: ok(attempt()) });
      }
      unexpected.push(`${request.method()} ${path}`);
      return route.fulfill({ status: 503, json: { error: "Unexpected operation in connection-only test" } });
    });
    await page.goto("/settings");
    await page.getByRole("button", { name: "Connect Business" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Connect Business" }).click();
    await expect(dialog.getByText(/No accessible ad account was returned/)).toBeVisible();
    await expect(dialog.getByText(/No accessible Facebook Page was returned/)).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Open business settings" })).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const bounds = await dialog.boundingBox();
    expect(bounds).not.toBeNull();
    expect(Math.abs(bounds!.x + bounds!.width / 2 - width / 2)).toBeLessThan(12);
    expect(bounds!.y).toBeGreaterThanOrEqual(16);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(884);
    await page.screenshot({ path: testInfo.outputPath(`recovery-${width}.png`) });
    await dialog.getByRole("button", { name: "Check again" }).click();
    await expect(dialog.getByRole("button", { name: "Use selected business" })).toBeDisabled();
    await dialog.getByRole("radio", { name: /Second Page/ }).check();
    const returned = page.waitForEvent("framenavigated", frame => frame === page.mainFrame());
    await dialog.getByRole("button", { name: "Use selected business" }).click();
    await returned;
    await page.waitForLoadState("load");
    await expect(dialog).not.toBeVisible();
    await page.getByRole("button", { name: "Connect Business" }).click();
    await expect(dialog.getByRole("heading", { name: "Connected to Meta" })).toBeVisible();
    await expect(dialog.getByText("Second Page", { exact: true })).toBeVisible();
    expect(selected).toBe(true);
    expect(unexpected).toEqual([]);
  });
}