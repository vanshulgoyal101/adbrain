import { test, expect } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { recoveryStorageKey } from "../src/lib/meta-connect-ui/recovery";

test("reload recovers an ambiguous create without mutation and retries the original identity", async ({ page, context }) => {
  const businessId = "11111111-1111-4111-8111-111111111111";
  const draft = { draftId: "22222222-2222-4222-8222-222222222222", version: 4, expiresAt: "2099-01-01T00:00:00.000Z",
    input: { businessId, name: "Recovery fixture", goal: "Book consultations", mode: "manual", creativeIds: [], dailyBudgetRupees: 500, leadFormId: "123", targeting: {}, abTest: false } };
  const request = { businessId, draftId: draft.draftId, draftVersion: 4, planHash: "a".repeat(64), connectionGeneration: 9, idempotencyKey: "original-request-identity" };
  const selected = { metaBusinessId: null, adAccountId: "act_123", accountName: "QA account", pageId: "456", pageName: "QA Page", currency: "INR", timezoneName: "Asia/Kolkata" };
  const capability = { state: "available", blockers: [] };
  const connection = { businessId, generation: 9, authorization: "connected", selected, checkedAt: null,
    capabilities: { canReadInsights: capability, canReadLeads: capability, canCreatePaused: capability, canActivate: capability } };
  const review = { draftId: draft.draftId, draftVersion: 4, connectionGeneration: 9, canCreatePaused: true, blockers: [], planHash: request.planHash, currency: "INR", perAdSetDailyBudgetRupees: 500, adSetCount: 1, totalDailyBudgetRupees: 500, resolvedAreaLabel: "Bengaluru", selected };
  let cookies: Parameters<typeof context.addCookies>[0] = [];
  const auth = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => [], setAll: updates => { cookies = updates.map(({ name, value }) => ({ name, value, domain: "localhost", path: "/", sameSite: "Lax" })); } },
  });
  const signedIn = await auth.auth.signInWithPassword({ email: process.env.DEV_LOGIN_EMAIL!, password: process.env.DEV_LOGIN_PASSWORD! });
  expect(signedIn.error).toBeNull();
  await context.addCookies(cookies);
  const key = recoveryStorageKey(signedIn.data.user!.id, businessId);
  await page.addInitScript(({ key, saved }) => {
    if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify(saved));
  }, { key, saved: { draft, request, operationId: null } });
  const createRequests: unknown[] = [];
  const unexpected: string[] = [];
  const respond = (data: unknown) => ({ ok: true, data, requestId: "33333333-3333-4333-8333-333333333333" });
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/campaign-drafts" && route.request().method() === "GET") return route.fulfill({ json: respond([]) });
    if (path === `/api/campaign-drafts/${draft.draftId}`) return route.fulfill({ json: respond(draft) });
    if (path === "/api/meta/connections/status") return route.fulfill({ json: respond(connection) });
    if (path === "/api/campaigns/preflight") return route.fulfill({ json: respond(review) });
    if (path === "/api/campaigns/operations") return route.fulfill({ json: respond(null) });
    if (path === "/api/campaigns/create") {
      createRequests.push(route.request().postDataJSON());
      if (createRequests.length === 1) return route.abort("failed");
      return route.fulfill({ json: respond({ operationId: "44444444-4444-4444-8444-444444444444", businessId, state: "needs_reconciliation", campaignId: null, blockers: [] }) });
    }
    unexpected.push(path);
    return route.fulfill({ status: 503, json: {} });
  });
  await page.goto("/campaigns");
  await expect(page.getByRole("button", { name: "Retry original request" })).toBeVisible();
  expect(createRequests).toEqual([]);
  await page.getByRole("button", { name: "Retry original request" }).click();
  await expect(page.getByRole("button", { name: "Check status", exact: true })).toBeEnabled();
  expect(createRequests).toEqual([request]);
  await page.reload();
  await expect(page.getByRole("button", { name: "Retry original request" })).toBeVisible();
  expect(createRequests).toEqual([request]);
  await page.getByRole("button", { name: "Retry original request" }).click();
  await expect(page.getByText("This operation needs reconciliation. Do not retry campaign creation.")).toBeVisible();
  expect(createRequests).toEqual([request, request]);
  expect(unexpected).toEqual([]);
  await expect(page.getByRole("button", { name: "Retry original request" })).toHaveCount(0);
});