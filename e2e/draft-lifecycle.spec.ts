import { test, expect, type BrowserContext } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const businessId = "11111111-1111-4111-8111-111111111111";
const creativeId = "77777777-7777-4777-8777-777777777777";

async function localFixture(context: BrowserContext) {
  const databaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  expect(["localhost", "127.0.0.1"]).toContain(new URL(databaseUrl).hostname);
  const admin = createClient(databaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  let cookies: Parameters<typeof context.addCookies>[0] = [];
  const auth = createServerClient(databaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { cookies: {
    getAll: () => [], setAll: updates => { cookies = updates.map(({ name, value }) => ({ name, value, domain: "localhost", path: "/", sameSite: "Lax" })); },
  } });
  const login = await auth.auth.signInWithPassword({ email: process.env.DEV_LOGIN_EMAIL!, password: process.env.DEV_LOGIN_PASSWORD! });
  expect(login.error).toBeNull();
  await context.addCookies(cookies);
  const seeded = await admin.from("creatives").upsert({ id: creativeId, business_id: businessId, brief: "Draft lifecycle fixture", headline: "Saved draft fixture", image_url: "/solar-example.jpg", status: "approved" });
  expect(seeded.error).toBeNull();
  return { admin, ownerId: login.data.user!.id };
}

for (const width of [1440, 390]) {
  test(`saved draft can be reopened in a new tab and removed at ${width}px`, async ({ page, context }, testInfo) => {
    const { admin } = await localFixture(context);
    const campaignMutations: string[] = [];
    await context.route("**/api/campaigns/**", route => {
      campaignMutations.push(new URL(route.request().url()).pathname);
      return route.fulfill({ status: 503, json: { error: "No campaign mutations in draft tests" } });
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/campaigns");
    await page.getByRole("textbox", { name: "Campaign name", exact: true }).fill(`Saved consultation ${width}`);
    await page.locator("#budget").fill("450");
    await page.getByRole("button", { name: "Saved draft fixture", exact: true }).click();
    const savedResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/campaign-drafts" && response.request().method() === "POST");
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    const saved = (await (await savedResponse).json()).data;
    try {
      const second = await context.newPage();
      await second.setViewportSize({ width, height: 900 });
      await second.goto("/campaigns");
      await second.getByRole("region", { name: "Saved drafts" }).getByRole("button", { name: new RegExp(`^Saved consultation ${width}`) }).click();
      await expect(second.locator("#name")).toHaveValue(`Saved consultation ${width}`);
      await expect(second.locator("#budget")).toHaveValue("450");
      await second.locator("#name").fill(`Edited consultation ${width}`);
      const updatedResponse = second.waitForResponse(response => response.url().includes(`/api/campaign-drafts/${saved.draftId}`) && response.request().method() === "PUT");
      await second.getByRole("button", { name: "Save draft", exact: true }).click();
      expect((await updatedResponse).ok()).toBe(true);
      const staleDelete = await context.request.delete(`/api/campaign-drafts/${saved.draftId}?version=${saved.version}`);
      expect(staleDelete.status()).toBe(409);
      await expect(second.getByText("Campaign draft saved.")).toBeVisible();
      expect(await second.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await second.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0); });
      await second.screenshot({ path: testInfo.outputPath(`saved-drafts-${width}.png`), fullPage: true });
      second.once("dialog", dialog => dialog.accept());
      await second.getByRole("button", { name: `Remove Edited consultation ${width}`, exact: true }).click();
      await expect(second.getByRole("button", { name: `Remove Edited consultation ${width}`, exact: true })).toHaveCount(0);
      await second.close();
      expect(campaignMutations).toEqual([]);
    } finally {
      await admin.from("campaign_drafts").delete().eq("id", saved.draftId);
      await admin.from("creatives").delete().eq("id", creativeId);
    }
  });
}

test("disconnected guided draft opens editable targeting and survives reload", async ({ page, context }, testInfo) => {
  const { admin, ownerId } = await localFixture(context);
  let draftId: string | undefined;
  await page.route("**/api/campaigns/plan", async route => {
    const input = { businessId, name: "Guided consultations", goal: "Leads around Jaipur", mode: "guided", creativeIds: [creativeId], dailyBudgetRupees: 550, leadFormId: null,
      targeting: { location: { mode: "ai", includedNames: ["Jaipur"], excludedNames: ["Ajmer"] }, age: { mode: "manual", min: 25, max: 55 } }, abTest: false };
    const result = await admin.from("campaign_drafts").insert({ business_id: businessId, owner_id: ownerId, input, expires_at: new Date(Date.now() + 86_400_000).toISOString() }).select("*").single();
    expect(result.error).toBeNull();
    draftId = result.data!.id;
    await route.fulfill({ json: { ready: true, draft: { draftId, version: result.data!.version, input, expiresAt: result.data!.expires_at } } });
  });
  try {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/campaigns");
    await page.getByRole("radio", { name: "Plan with AdBrain", exact: true }).check();
    await page.locator("textarea").fill("Leads around Jaipur, excluding Ajmer, 550 per day.");
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await page.getByRole("button", { name: "Close connection dialog", exact: true }).click();
    await expect(page.locator("#name")).toHaveValue("Guided consultations");
    await expect(page.locator("#planned-areas")).toHaveValue("Jaipur");
    await expect(page.locator("#planned-exclusions")).toHaveValue("Ajmer");
    await page.reload();
    await expect(page.locator("#name")).toHaveValue("Guided consultations");
    await expect(page.locator("#planned-exclusions")).toHaveValue("Ajmer");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByText(/People in Jaipur/)).toBeVisible();
    await expect(page.getByText(/People in Bengaluru/)).toHaveCount(0);
    await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0); });
    await page.screenshot({ path: testInfo.outputPath("guided-draft-mobile.png"), fullPage: true });
  } finally {
    if (draftId) await admin.from("campaign_drafts").delete().eq("id", draftId);
    await admin.from("creatives").delete().eq("id", creativeId);
  }
});