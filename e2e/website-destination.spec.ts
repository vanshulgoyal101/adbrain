import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { signInBrowser } from "../scripts/lib/test-session.mjs";
import recorded from "../tests/core/fixtures/meta/launch-validate-website.json";
import { MetaClient } from "@/lib/meta/client";

/**
 * #2595 phase 1 acceptance: an owner sends ads to their website, and WhatsApp (the default) is unchanged.
 * Meta is never reached: connection, preflight and create are answered at the API boundary, so nothing spends.
 * The real draft API and local database store the input, so the draft contract is checked as saved.
 * The launch step runs the real Meta adapter on the owner's Review choices with only Graph stubbed, and every
 * payload must equal one Meta accepted with validate_only (tests/core/fixtures/meta/launch-validate-website.json).
 * Done when slices C (#2599, preflight) and D (#2600, composer and Review) are on next.
 */

const businessId = "11111111-1111-4111-8111-111111111111";
const requestId = "33333333-3333-4333-8333-333333333333";
const operationId = "44444444-4444-4444-8444-444444444444";
const website = "https://example.com/rooftop-solar";
const planHash = "b".repeat(64);
const whatsappNumber = "+919800000000";
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
type Seen = { preflight: Record<string, unknown>[]; create: Record<string, unknown>[]; unexpected: string[]; draftIds: Set<string> };

/** A local business with (or without) a website and one approved ad named `headline`. */
async function seed(admin: Admin, creativeId: string, headline: string, site: string | null) {
  const before = await admin.from("businesses").select("website").eq("id", businessId).single();
  expect(before.error).toBeNull();
  expect((await admin.from("businesses").update({ website: site }).eq("id", businessId)).error).toBeNull();
  const creative = await admin.from("creatives").upsert({ id: creativeId, business_id: businessId, brief: "Website destination fixture", angle: "Value", image_url: "/solar-example.jpg",
    headline, primary_text: "Local synthetic fixture", cta: "Learn More", status: "approved" });
  expect(creative.error).toBeNull();
  return async (seen: Seen) => {
    for (const id of seen.draftIds) await admin.from("campaign_drafts").delete().eq("id", id);
    await admin.from("creatives").delete().eq("id", creativeId);
    await admin.from("businesses").update({ website: before.data?.website ?? null }).eq("id", businessId);
  };
}

/** Meta-facing routes are answered here; drafts go to the real local API; any other write is a test failure. */
async function mockMeta(context: BrowserContext, review: (body: Record<string, unknown>) => Record<string, unknown>): Promise<Seen> {
  const seen: Seen = { preflight: [], create: [], unexpected: [], draftIds: new Set() };
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
      return route.fulfill({ json: ok(review(body)) });
    }
    if (path === "/api/campaigns/create") {
      seen.create.push(request.postDataJSON());
      return route.fulfill({ json: ok({ operationId, businessId, state: "succeeded", campaignId: null, blockers: [] }) });
    }
    if (path === "/api/events" || request.method() === "GET") return route.continue();
    seen.unexpected.push(`${request.method()} ${path}`);
    return route.fulfill({ status: 503, json: { error: "Unexpected write during the website destination test" } });
  });
  return seen;
}

function reviewFor(body: Record<string, unknown>, extra: Record<string, unknown>) {
  return { draftId: body.draftId, draftVersion: body.draftVersion, connectionGeneration: 1, canCreatePaused: true, blockers: [], planHash, currency: "INR",
    perAdSetDailyBudgetRupees: 400, adSetCount: 1, totalDailyBudgetRupees: 400, resolvedAreaLabel: "Bengaluru", selected, ...extra };
}

async function storedInput(admin: Admin, draftId: unknown) {
  const stored = await admin.from("campaign_drafts").select("input,version").eq("id", draftId as string).single();
  expect(stored.error).toBeNull();
  return stored.data!.input as Record<string, unknown>;
}

async function openComposer(page: Page, headline: string, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/campaigns");
  await page.getByRole("button", { name: headline }).click();
  await expect(page.getByRole("button", { name: headline })).toHaveAttribute("aria-pressed", "true");
  await page.locator("#budget").fill("400");
}

type Exchange = { kind: string; form: Record<string, string>; status: number; body: unknown };
const tape = recorded.tape as unknown as Exchange[];
const LAUNCH_KINDS = ["campaigns", "adsets", "adcreatives", "ads"];
const IDS: Record<string, string> = { campaigns: "CAMPAIGN", adsets: "ADSET", adcreatives: "CREATIVE", ads: "AD" };

/**
 * The payloads the Meta adapter sends for the owner's link; each ad keeps its own button (no composer choice, QA on #2660). Graph is stubbed in this test process only:
 * nothing leaves the machine, so nothing spends. Inputs other than the link are the taped ones.
 */
async function launchPayloads(link: string) {
  const sent: { kind: string; form: Record<string, string> }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname !== "graph.facebook.com") return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
    if ((init?.method ?? "GET") !== "POST") {
      if (url.searchParams.get("type") === "adgeolocationmeta") return Response.json(recorded.geoMeta.body, { status: recorded.geoMeta.status });
      throw new Error(`Unexpected Graph read during the website launch: ${url.pathname}`);
    }
    const kind = url.pathname.split("/").pop()!;
    if (kind === "adimages") return Response.json({ images: { image: { hash: "FEED_HASH" } } });
    sent.push({ kind, form: Object.fromEntries([...(init!.body as URLSearchParams)].filter(([key]) => key !== "access_token")) });
    return Response.json({ id: IDS[kind] });
  }) as typeof fetch;
  try {
    const inputs = recorded.inputs;
    const meta = new MetaClient({ adAccountId: "act_ACCOUNT", pageId: "PAGE", accessToken: "test-token" });
    await meta.createLeadCampaign({
      name: inputs.name, dailyBudgetRupees: inputs.dailyBudgetRupees, link, ageMin: inputs.ageMin, ageMax: inputs.ageMax,
      gender: inputs.gender as "all", location: inputs.location, interests: inputs.interests,
      creatives: [{ imageUrl: "https://adbrain.vanshul.com/solar-example.jpg", ...inputs.creative }],
      destination: "website",
    });
  } finally {
    globalThis.fetch = realFetch;
  }
  return sent;
}

/** What Meta accepted with validate_only for this button type, moved to the owner's link. */
function acceptedFor(link: string, type: "LEARN_MORE" | "SHOP_NOW" | "SIGN_UP") {
  const accepted = (kind: string) => {
    const exchange = tape.find(e => e.kind === kind)!;
    expect(exchange, kind).toMatchObject({ status: 200, body: { success: true } });
    return exchange.form;
  };
  const creative = accepted(type === "LEARN_MORE" ? "adcreatives" : `adcreatives-cta-${type}`);
  const story = JSON.parse(creative.object_story_spec);
  story.link_data.link = link;
  story.link_data.call_to_action = { type, value: { link } };
  return LAUNCH_KINDS.map(kind => ({ kind, form: kind === "adcreatives" ? { ...creative, object_story_spec: JSON.stringify(story) } : accepted(kind) }));
}

const reviewPanel = (page: Page) => page.locator("div").filter({ has: page.getByRole("heading", { name: "Campaign review" }) }).last();
const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

for (const width of [1440, 390]) {
  test(`website destination: URL reaches Review and a paused create at ${width}px`, async ({ page, context }, testInfo) => {
    const admin = adminClient();
    const headline = `Website fixture ${width}`;
    const cleanup = await seed(admin, width === 390 ? "77777777-7777-4777-8777-777777777390" : "77777777-7777-4777-8777-777777771440", headline, "example.com/rooftop-solar");
    const seen = await mockMeta(context, body => reviewFor(body, { destination: "website", websiteUrl: website, whatsappNumber: null }));
    try {
      await signInBrowser(context, "http://localhost:3939", process.env.DEV_LOGIN_EMAIL!);
      await openComposer(page, headline, width);
      await expect(page.locator("#destination-whatsapp")).toBeChecked();
      await page.locator("#destination-website").check();
      // The landing page is the Brand Website (a bare domain gets https); the button is each ad's own, not chosen here.
      await expect(page.locator("#website-destination").getByRole("link", { name: "Open" })).toHaveAttribute("href", website);
      await expect(page.locator('input[name="website-cta"]')).toHaveCount(0);
      await page.getByRole("button", { name: "Check my campaign (nothing spends)" }).click();

      const panel = reviewPanel(page);
      await expect(panel).toBeVisible();
      await expect(panel.getByRole("link", { name: "Open" })).toHaveAttribute("href", website);
      await expect(panel).not.toContainText("Button:");
      await expect(panel).not.toContainText("WhatsApp");
      await expect(panel).not.toContainText("Instant lead form");

      expect(seen.preflight).toHaveLength(1);
      const input = await storedInput(admin, seen.preflight[0].draftId);
      expect(input).toMatchObject({ destination: "website", leadFormId: null });
      expect(input).not.toHaveProperty("websiteCta");
      expect(input).not.toHaveProperty("whatsappNumber");
      expect(input).not.toHaveProperty("whatsappMessage");
      expect(await fitsWidth(page)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`website-review-${width}.png`), fullPage: true });

      await page.getByRole("button", { name: "Send to Meta (paused)" }).click();
      await expect(page.getByText("Paused campaign created. Review it before activating spend.")).toBeVisible();
      expect(seen.create).toEqual([expect.objectContaining({ businessId, draftId: seen.preflight[0].draftId, draftVersion: seen.preflight[0].draftVersion, planHash, connectionGeneration: 1 })]);
      expect(seen.unexpected).toEqual([]);
      expect(await fitsWidth(page)).toBe(true);

      // The launch for what Review passed: a paused website-visits campaign, exactly as Meta accepted with validate_only.
      // The taped creative's "Get Quote" maps to Learn more.
      const sent = await launchPayloads(website);
      expect(sent).toEqual(acceptedFor(website, "LEARN_MORE"));
      expect(sent.filter(s => "status" in s.form).map(s => s.form.status)).toEqual(["PAUSED", "PAUSED", "PAUSED"]);
    } finally {
      await cleanup(seen);
    }
  });
}

test("website destination without a Brand website: Review blocks the send and offers the fixes", async ({ page, context }) => {
  const admin = adminClient();
  const headline = "Website fixture no site";
  const cleanup = await seed(admin, "77777777-7777-4777-8777-777777770000", headline, null);
  const blocker = { code: "PREFLIGHT_BLOCKED", reason: "REVIEW_NO_WEBSITE", message: "Add your business website on the Your business page.", action: { kind: "open_brand" } };
  const seen = await mockMeta(context, body => reviewFor(body, { destination: "website", websiteUrl: null, canCreatePaused: false, planHash: null, blockers: [blocker] }));
  try {
    await signInBrowser(context, "http://localhost:3939", process.env.DEV_LOGIN_EMAIL!);
    await openComposer(page, headline, 390);
    await page.locator("#destination-website").check();
    await expect(page.locator("#website-destination")).toContainText("Add your website in Brand first.");
    await page.getByRole("button", { name: "Check my campaign (nothing spends)" }).click();
    await expect(page.getByRole("heading", { name: "Fix 1 item before sending to Meta" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add your website" })).toHaveAttribute("href", "/brand");
    await expect(page.getByRole("button", { name: "Send to Meta (paused)" })).toHaveCount(0);
    await page.getByRole("button", { name: "Use WhatsApp chat instead (no website needed)" }).click();
    await expect(page.locator("#destination-whatsapp")).toBeChecked();
    expect(seen.create).toEqual([]);
    expect(seen.unexpected).toEqual([]);
    expect(await fitsWidth(page)).toBe(true);
  } finally {
    await cleanup(seen);
  }
});

test("WhatsApp stays the default and its draft and Review carry nothing from the website path", async ({ page, context }, testInfo) => {
  const admin = adminClient();
  const headline = "WhatsApp fixture unchanged";
  const cleanup = await seed(admin, "77777777-7777-4777-8777-777777770001", headline, "example.com/rooftop-solar");
  const seen = await mockMeta(context, body => reviewFor(body, { destination: "whatsapp", whatsappNumber }));
  try {
    await signInBrowser(context, "http://localhost:3939", process.env.DEV_LOGIN_EMAIL!);
    await openComposer(page, headline, 390);
    await expect(page.locator("#destination-whatsapp")).toBeChecked();
    await expect(page.locator("#website-destination")).toHaveCount(0);
    await page.getByRole("button", { name: "Check my campaign (nothing spends)" }).click();

    const panel = reviewPanel(page);
    await expect(panel.getByText(`WhatsApp chat ${whatsappNumber}`)).toBeVisible();
    await expect(panel.getByText("Shown on Facebook, Instagram and Messenger")).toBeVisible();
    await expect(panel).not.toContainText("Button:");
    await expect(panel).not.toContainText(website);

    expect(seen.preflight).toHaveLength(1);
    const input = await storedInput(admin, seen.preflight[0].draftId);
    expect(input).toMatchObject({ destination: "whatsapp", leadFormId: null });
    expect(input).not.toHaveProperty("websiteCta");
    expect(input).not.toHaveProperty("websiteUrl");
    await page.screenshot({ path: testInfo.outputPath("whatsapp-review-390.png"), fullPage: true });

    await page.getByRole("button", { name: "Send to Meta (paused)" }).click();
    await expect(page.getByText("Paused campaign created. Review it before activating spend.")).toBeVisible();
    expect(seen.create).toEqual([expect.objectContaining({ businessId, draftId: seen.preflight[0].draftId, planHash })]);
    expect(seen.unexpected).toEqual([]);
    expect(await fitsWidth(page)).toBe(true);
  } finally {
    await cleanup(seen);
  }
});
