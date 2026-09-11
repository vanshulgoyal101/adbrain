import { test, expect } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

for (const width of [1440, 390]) {
  test(`draft-first connection preserves editable work at ${width}px`, async ({ page, context }, testInfo) => {
    const databaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    expect(["localhost", "127.0.0.1"]).toContain(new URL(databaseUrl).hostname);
    const businessId = "11111111-1111-4111-8111-111111111111";
    const creativeId = "66666666-6666-4666-8666-666666666666";
    const attemptId = "22222222-2222-4222-8222-222222222222";
    const requestId = "33333333-3333-4333-8333-333333333333";
    const admin = createClient(databaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const seeded = await admin.from("creatives").upsert({ id: creativeId, business_id: businessId, brief: "Local connection test", angle: "Value", image_url: "/solar-example.jpg", headline: "Connection journey fixture", primary_text: "Local synthetic fixture", cta: "Book Now", status: "approved" });
    expect(seeded.error).toBeNull();
    let cookies: Parameters<typeof context.addCookies>[0] = [];
    const auth = createServerClient(databaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      cookies: { getAll: () => [], setAll: updates => { cookies = updates.map(({ name, value }) => ({ name, value, domain: "localhost", path: "/", sameSite: "Lax" })); } },
    });
    expect((await auth.auth.signInWithPassword({ email: process.env.DEV_LOGIN_EMAIL!, password: process.env.DEV_LOGIN_PASSWORD! })).error).toBeNull();
    await context.addCookies(cookies);
    await page.setViewportSize({ width, height: 900 });
    if (width === 390) await page.addInitScript(() => { window.open = () => null; });
    let connected = false;
    let formReads = 0;
    let savedDraftId: string | undefined;
    let savedVersion: number | undefined;
    const mutations: string[] = [];
    const capability = { state: "available", blockers: [] };
    const selected = { metaBusinessId: null, adAccountId: "act_123", accountName: "QA account", pageId: "456", pageName: "QA Page", currency: "INR", timezoneName: "Asia/Kolkata" };
    const connection = () => ({ businessId, generation: connected ? 1 : 0, authorization: connected ? "connected" : "disconnected", selected: connected ? selected : null,
      capabilities: { canReadInsights: capability, canReadLeads: capability, canCreatePaused: capability, canActivate: capability }, checkedAt: null });
    const ok = (data: unknown) => ({ ok: true, data, requestId });
    await context.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith("/api/campaign-drafts")) return route.continue();
      if (path === "/api/campaigns/preflight") return route.continue();
      if (path === "/api/meta/connections/status") return route.fulfill({ json: ok(connection()) });
      if (path === "/api/meta/connections/start") {
        const intent = route.request().postDataJSON().intent;
        savedDraftId = intent.draftId;
        savedVersion = intent.draftVersion;
        expect(intent.kind).toBe("prepare_campaign");
        const stored = await admin.from("campaign_drafts").select("input,version").eq("id", savedDraftId).single();
        expect(stored.error).toBeNull();
        expect(stored.data?.input).toMatchObject({ name: "Weekend rooftop consultations", dailyBudgetRupees: 350, creativeIds: [creativeId], leadFormId: null, abTest: true });
        expect(stored.data?.version).toBe(savedVersion);
        return route.fulfill({ json: ok({ attemptId, authorizationUrl: "http://localhost:3939/qa-meta-consent", expiresAt: "2099-01-01T00:00:00.000Z" }) });
      }
      if (path === `/api/meta/connections/attempts/${attemptId}`) return route.fulfill({ json: ok({ attemptId, businessId, intent: { kind: "prepare_campaign", draftId: savedDraftId, draftVersion: savedVersion }, expiresAt: "2099-01-01T00:00:00.000Z", revision: 1,
        state: connected ? "connected" : "authorizing", discoveryComplete: connected, candidates: [], connection: connected ? connection() : null, blockers: [], retryAfterMs: 500 }) });
      if (path === "/api/campaigns/lead-forms") {
        formReads += 1;
        return route.fulfill({ json: { forms: [{ id: "fresh-form", name: "Rooftop enquiry", status: "ACTIVE" }] } });
      }
      mutations.push(`${route.request().method()} ${path}`);
      return route.fulfill({ status: 503, json: { error: "Unexpected operation during connection-only test" } });
    });
    await context.route("**/qa-meta-consent", async route => {
      connected = true;
      await route.fulfill({ contentType: "text/html", body: `<html><body>Meta consent fixture<script>if(window.opener){window.opener.postMessage({type:'adbrain.meta.complete',attemptId:'${attemptId}'},location.origin);}else{location.replace('/campaigns');}</script></body></html>` });
    });
    await page.goto("/campaigns");
    await page.getByRole("button", { name: "Connection journey fixture" }).click();
    await page.getByRole("textbox", { name: "Campaign name", exact: true }).fill("Weekend rooftop consultations");
    await page.locator("#budget").fill("350");
    await page.getByRole("checkbox", { name: /A\/B test the audience/ }).check();
    await expect(page.getByRole("button", { name: "Prepare campaign review" })).toBeEnabled();
    await page.getByRole("button", { name: "Prepare campaign review" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Connect Business" }).click();
    await expect(page.getByRole("option", { name: "Rooftop enquiry" })).toHaveCount(1);
    await expect(page.getByRole("textbox", { name: "Campaign name", exact: true })).toHaveValue("Weekend rooftop consultations");
    await expect(page.locator("#budget")).toHaveValue("350");
    await expect(page.getByRole("checkbox", { name: /A\/B test the audience/ })).toBeChecked();
    await expect(page.getByRole("button", { name: "Connection journey fixture" })).toHaveAttribute("aria-pressed", "true");
    await page.locator("#leadform").selectOption("fresh-form");
    await expect(page.locator("#leadform")).toHaveValue("fresh-form");
    const update = page.waitForResponse(response => new URL(response.url()).pathname === `/api/campaign-drafts/${savedDraftId}` && response.request().method() === "PUT");
    await page.getByRole("button", { name: "Prepare campaign review" }).click();
    expect((await update).ok()).toBe(true);
    const updated = await admin.from("campaign_drafts").select("input,version").eq("id", savedDraftId).single();
    expect(updated.data?.input).toMatchObject({ name: "Weekend rooftop consultations", leadFormId: "fresh-form", dailyBudgetRupees: 350, abTest: true });
    expect(updated.data?.version).toBe(savedVersion! + 1);
    expect(formReads).toBeGreaterThan(0);
    expect(mutations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`draft-connected-${width}.png`), fullPage: true });
    await admin.from("campaign_drafts").delete().eq("id", savedDraftId!);
    await admin.from("creatives").delete().eq("id", creativeId);
  });
}