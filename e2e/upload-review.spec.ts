import { readFile } from "node:fs/promises";
import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { signInBrowser } from "../scripts/lib/test-session.mjs";

/**
 * #744 acceptance: an owner adds their own photo, writes its words, approves it in Review, and sends it to Meta
 * paused next to an AI ad. Run with MEDIA_UPLOADS_ENABLED=1 against local Supabase:
 *   MEDIA_UPLOADS_ENABLED=1 npm run test:workspace-browser -- e2e/upload-review.spec.ts
 * Upload and library go to the real local API, database and Storage. Paid AI and Meta are never reached: the
 * owner writes the words ("I'll write them"), and Meta connection, preflight and create are answered here.
 * Done when: test 1 by #1224/#1245/#1973 (library and Create entry); test 2 by #780 (own words, "Your photo" in
 * Review) and #781 (Review and Launch with owner media). Words are the CPO's from #780/#781.
 */

const businessId = "11111111-1111-4111-8111-111111111111";
const aiCreativeId = "88888888-8888-4888-8888-888888888801";
const requestId = "33333333-3333-4333-8333-333333333333";
const operationId = "44444444-4444-4444-8444-444444444444";
const planHash = "c".repeat(64);
const photoName = "qa-rooftop-744";
const ownHeadline = "Rooftop solar we fitted last week";
const selected = { metaBusinessId: null, adAccountId: "act_123", accountName: "QA account", pageId: "456", pageName: "QA Page", currency: "INR", timezoneName: "Asia/Kolkata" };
const capability = { state: "available", blockers: [] };
const connection = { businessId, generation: 1, authorization: "connected", selected, checkedAt: null,
  capabilities: { canReadInsights: capability, canReadLeads: capability, canCreatePaused: capability, canActivate: capability } };
const targeting = { gender: "all", age: { mode: "manual", min: 25, max: 55 }, audience: { interestNames: ["Solar energy"], rationale: "QA fixture audience" } };
const ok = (data: unknown) => ({ ok: true, data, requestId });

function adminClient() {
  const databaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  expect(["localhost", "127.0.0.1"]).toContain(new URL(databaseUrl).hostname);
  return createClient(databaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
}
type Admin = ReturnType<typeof adminClient>;

/** Removes everything this spec made: the uploaded photo (row and file), ads made from it, drafts, and a new consent. */
async function cleanup(admin: Admin, consentBefore: boolean, draftIds: Set<string>) {
  const assets = await admin.from("media_assets").select("id,path").eq("business_id", businessId).eq("name", photoName);
  const ids = (assets.data ?? []).map((asset) => asset.id as string);
  for (const id of draftIds) await admin.from("campaign_drafts").delete().eq("id", id);
  if (ids.length) {
    await admin.from("creatives").delete().in("media_asset_id", ids);
    await admin.storage.from("media").remove((assets.data ?? []).map((asset) => asset.path as string));
    await admin.from("media_assets").delete().in("id", ids);
  }
  await admin.from("creatives").delete().eq("id", aiCreativeId);
  if (!consentBefore) await admin.from("media_consents").delete().eq("business_id", businessId);
}

async function hasConsent(admin: Admin) {
  const consent = await admin.from("media_consents").select("business_id", { count: "exact", head: true }).eq("business_id", businessId);
  expect(consent.error).toBeNull();
  return (consent.count ?? 0) > 0;
}

/** Media, drafts and pages go to the local server; Meta-facing routes are answered; paid AI or any other write fails. */
async function guard(context: BrowserContext) {
  const seen = { preflight: [] as Record<string, unknown>[], create: [] as Record<string, unknown>[], unexpected: [] as string[], draftIds: new Set<string>() };
  await context.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/campaign-drafts")) {
      const response = await route.fetch();
      const json = await response.json().catch(() => null);
      if (json?.data?.draftId) seen.draftIds.add(json.data.draftId);
      return route.fulfill({ response, json });
    }
    if (path === "/api/meta/connections/status") return route.fulfill({ json: ok(connection) });
    if (path === "/api/meta/whatsapp") return route.fulfill({ json: { state: "ready", numbers: [{ masked: "+91 ••••• 0000", source: "page" }] } });
    if (path === "/api/campaigns/plan") return route.fulfill({ json: { ready: true, targeting } });
    if (path === "/api/campaigns/preflight") {
      const body = request.postDataJSON();
      seen.preflight.push(body);
      return route.fulfill({ json: ok({ draftId: body.draftId, draftVersion: body.draftVersion, connectionGeneration: 1, canCreatePaused: true, blockers: [], planHash,
        destination: "whatsapp", whatsappNumber: "+919800000000", currency: "INR", perAdSetDailyBudgetRupees: 300, adSetCount: 1, totalDailyBudgetRupees: 300,
        resolvedAreaLabel: "Bengaluru", selected }) });
    }
    if (path === "/api/campaigns/create") {
      seen.create.push(request.postDataJSON());
      return route.fulfill({ json: ok({ operationId, businessId, state: "succeeded", campaignId: null, blockers: [] }) });
    }
    // The owner's own words: #780's "I'll write them" makes no model call; "Write the words for me" (paid) must not run here.
    const paidWords = path === "/api/media/ads" && (request.postDataJSON() as { mode?: string } | null)?.mode !== "own";
    if (path.startsWith("/api/media") && !paidWords) return route.continue();
    if (path === "/api/events" || request.method() === "GET") return route.continue();
    seen.unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 503, json: { error: "Unexpected write during the upload test" } });
  });
  return seen;
}

/** Create's entry choice → library → sheet → pick → rights tick (first time) → Add 1 photo → Added. */
async function uploadPhoto(page: Page, consented: boolean) {
  await page.goto("/create");
  await page.getByRole("navigation", { name: "How to make ads" }).getByRole("link", { name: "Use my photos & videos" }).click();
  await expect(page).toHaveURL(/\/assets/);
  await expect(page.getByRole("heading", { name: "Photos & videos" })).toBeVisible();
  await page.getByRole("button", { name: "Add photos & videos" }).first().click();
  const sheet = page.getByRole("dialog", { name: "Add photos & videos" });
  await sheet.getByLabel("Choose photos").setInputFiles({ name: `${photoName}.jpg`, mimeType: "image/jpeg", buffer: await readFile("public/solar-example.jpg") });
  const pick = sheet.getByRole("list", { name: "Your picks" }).getByRole("listitem").filter({ hasText: photoName });
  await expect(pick).toBeVisible();
  const add = sheet.getByRole("button", { name: "Add 1 photo" });
  await expect(add).toBeEnabled();
  if (!consented) {
    await add.click();
    await expect(sheet.getByRole("alert")).toHaveText("Tick the box above to add your photos.");
    for (const box of await sheet.getByRole("group", { name: "Your rights to these files" }).getByRole("checkbox").all()) await box.check();
  }
  await add.click();
  await expect(pick).toContainText("Added");
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("heading", { name: /Your photos/ })).toContainText("(");
  await expect(page.getByText(photoName, { exact: true })).toBeVisible();
}

const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const width of [390, 1440]) {
  test(`own photo: Create entry → library upload with the rights tick at ${width}px`, async ({ page, context }, testInfo) => {
    const admin = adminClient();
    const consentBefore = await hasConsent(admin);
    const seen = await guard(context);
    try {
      await signInBrowser(context, "http://localhost:3939", process.env.DEV_LOGIN_EMAIL!);
      await page.setViewportSize({ width, height: 900 });
      await uploadPhoto(page, consentBefore);
      const saved = await admin.from("media_assets").select("status,width,height").eq("business_id", businessId).eq("name", photoName).single();
      expect(saved.error).toBeNull();
      // Re-encoded in the browser: long side at most 2048 px, a JPEG, stored ready and private.
      expect(saved.data).toMatchObject({ status: "ready" });
      expect(Math.max(saved.data!.width, saved.data!.height)).toBeLessThanOrEqual(2048);
      expect(await hasConsent(admin)).toBe(true);
      expect(seen.unexpected).toEqual([]);
      expect(await fitsWidth(page)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`library-${width}.png`), fullPage: true });
    } finally {
      await cleanup(admin, consentBefore, seen.draftIds);
    }
  });
}

test("own photo: own words → Review tags it 'Your photo' → sent to Meta paused with an AI ad", async ({ page, context }, testInfo) => {
  const admin = adminClient();
  const consentBefore = await hasConsent(admin);
  const ai = await admin.from("creatives").upsert({ id: aiCreativeId, business_id: businessId, brief: "Upload journey fixture", angle: "Value", image_url: "/solar-example.jpg",
    headline: "AI fixture ad 744", primary_text: "Local synthetic fixture", cta: "Learn More", status: "approved" });
  expect(ai.error).toBeNull();
  const seen = await guard(context);
  try {
    await signInBrowser(context, "http://localhost:3939", process.env.DEV_LOGIN_EMAIL!);
    await page.setViewportSize({ width: 390, height: 900 });
    await uploadPhoto(page, consentBefore);

    // #780: choose the photo, then one screen for the batch; the owner writes the words, so no model runs.
    await page.getByRole("checkbox", { name: photoName }).check();
    await page.getByRole("button", { name: "Make ads from these (1)" }).click();
    await page.getByRole("radio", { name: "I'll write them" }).check();
    await page.getByRole("textbox", { name: "Headline" }).fill(ownHeadline);
    await page.getByRole("textbox", { name: "Primary text" }).fill("We fitted this rooftop system last week. Message us for a free site visit.");
    await page.getByRole("button", { name: "Use this ad" }).click();

    // Review lists it next to AI ads, tagged, and approved.
    await page.goto("/studio");
    const ownAd = page.getByRole("region", { name: "Ads" }).getByRole("listitem").filter({ hasText: ownHeadline });
    await expect(ownAd).toContainText("Your photo");
    await expect(ownAd).toContainText("Approved");
    expect(await fitsWidth(page)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("review-own-photo-390.png"), fullPage: true });

    // #781: the composer mixes it with an AI ad; WhatsApp stays the default; one paused create, Meta mocked.
    await page.goto("/campaigns");
    await page.getByRole("button", { name: ownHeadline }).click();
    await page.getByRole("button", { name: "AI fixture ad 744" }).click();
    await expect(page.locator("#destination-whatsapp")).toBeChecked();
    await page.locator("#budget").fill("300");
    await page.getByRole("button", { name: "Check my campaign (nothing spends)" }).click();
    await expect(page.getByRole("heading", { name: "Campaign review" })).toBeVisible();
    expect(seen.preflight).toHaveLength(1);
    const own = await admin.from("creatives").select("id,source,status").eq("headline", ownHeadline).single();
    expect(own.error).toBeNull();
    expect(own.data).toMatchObject({ source: "upload", status: "approved" });
    const draft = await admin.from("campaign_drafts").select("input").eq("id", seen.preflight[0].draftId as string).single();
    expect((draft.data?.input as { creativeIds: string[] }).creativeIds.sort()).toEqual([aiCreativeId, own.data!.id].sort());
    await page.getByRole("button", { name: "Send to Meta (paused)" }).click();
    await expect(page.getByText("Paused campaign created. Review it before activating spend.")).toBeVisible();
    expect(seen.create).toEqual([expect.objectContaining({ businessId, draftId: seen.preflight[0].draftId, planHash })]);
    expect(seen.unexpected).toEqual([]);
    expect(await fitsWidth(page)).toBe(true);
  } finally {
    await cleanup(admin, consentBefore, seen.draftIds);
  }
});
