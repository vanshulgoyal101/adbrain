import { expect, test, type BrowserContext } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";

let authCookies: Parameters<BrowserContext["addCookies"]>[0] = [];

type CreateStream = { __createPush: (line: object) => void; __createEnd: () => void };

for (const width of [1440, 390, 320]) {
  test(`Create harness at ${width}px`, async ({ page, context }, testInfo) => {
    await context.addCookies(authCookies);
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    const interviewBodies: Record<string, unknown>[] = [];
    const generationBodies: Record<string, unknown>[] = [];
    const recoveryIds: string[] = [];
    const fixture = { id: "creative-harness-fixture", business_id: "fixture", image_url: "/solar-example.jpg", headline: "Meet our team", primary_text: "Ask about our services.", cta: "Learn More", status: "draft" };
    page.on("pageerror", (error) => errors.push(error.message));
    // The POST is answered in the page so the test can release one NDJSON line at a time.
    await page.exposeFunction("__recordCreate", (body: Record<string, unknown>) => { generationBodies.push(body); });
    await page.addInitScript(() => {
      const realFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input), location.href);
        if (url.pathname !== "/api/creatives/generate" || init?.method !== "POST") return realFetch(input, init);
        await (window as unknown as { __recordCreate: (body: unknown) => Promise<void> }).__recordCreate(JSON.parse(String(init.body)));
        const encoder = new TextEncoder();
        let open = true;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const create: CreateStream = {
              __createPush: (line) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`)),
              __createEnd: () => { if (open) controller.close(); },
            };
            Object.assign(window, create);
          },
          cancel() { open = false; },
        });
        return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } });
      };
    });
    const push = async (...lines: object[]) => {
      await page.waitForFunction(() => "__createPush" in window);
      await page.evaluate((lines) => lines.forEach((line) => (window as unknown as CreateStream).__createPush(line)), lines);
    };
    const names = { proof: "Customer proof", value: "Clear value", story: "Team story" };
    const stage = (angleId: keyof typeof names, stage: string) => ({ type: "progress", angleId, angleName: names[angleId], stage, at: Date.now() });
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== "http://localhost:3939") return route.abort();
      if (url.pathname === "/api/creatives/assistant") {
        const body = request.postDataJSON();
        interviewBodies.push(body);
        return route.fulfill({ json: body.answers.length || body.referenceBrief
          ? { ready: true, brief: "Show the team working in an illustrative service setting. Invite enquiries using saved business facts." }
          : { ready: false, question: { id: "visual-scene", field: "visual", question: "Which scene fits this introduction?", options: ["Team at work", "Service setting"], allowText: true } } });
      }
      if (url.pathname === "/api/creatives/generate" && request.method() === "GET") {
        recoveryIds.push(url.searchParams.get("generationId") ?? "");
        return route.fulfill({ json: { status: "complete", creatives: [fixture], failures: [] } });
      }
      if (request.method() !== "GET" || url.pathname.startsWith("/api/")) return route.fulfill({ status: 503, json: { error: "Live operations disabled in browser validation." } });
      return route.continue();
    });
    const checkLayout = async (name: string) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`create-${name}-${width}.png`), fullPage: true });
    };
    await page.goto("/create");
    await page.getByRole("textbox", { name: "Campaign goal" }).fill("Introduce our team to new customers");
    await checkLayout("goal");
    await page.getByRole("button", { name: /^(Start creating|Edit brief)$/ }).click(); // #1004: a complete Brand offers "Edit brief" to keep the brief review
    await expect(page.getByRole("button", { name: "Team at work", exact: true })).toBeVisible();
    await checkLayout("question");
    await page.getByRole("button", { name: "Team at work", exact: true }).click();
    const brief = page.getByRole("textbox", { name: "Creative brief", exact: true });
    await expect(brief).toBeVisible();
    expect(interviewBodies[1].answers).toEqual([expect.objectContaining({ field: "visual", questionId: "visual-scene", answer: "Team at work" })]);
    expect(generationBodies).toHaveLength(0);
    const edited = "Use an illustrative service setting. " + "Keep the saved brand voice and factual details. ".repeat(8) + "Do not include people.";
    await brief.fill(edited);
    await page.reload();
    await expect(brief).toHaveValue(edited);
    await checkLayout("review");
    await page.getByRole("button", { name: "Generate 3 ads" }).click();
    const progress = page.getByRole("region", { name: "Ads being created" });
    for (const label of ["Ad 1", "Ad 2", "Ad 3"]) await expect(progress.getByText(label, { exact: true })).toBeVisible();
    await expect(progress.getByText("Creating 3 ads")).toBeVisible();
    await expect(progress.getByRole("progressbar", { name: "Ads created" })).toBeVisible();
    await checkLayout("progress-start");
    await push(stage("proof", "queued"), stage("value", "queued"), stage("story", "queued"), stage("proof", "writing"), stage("value", "checking"), stage("value", "fixing"), stage("story", "image"));
    for (const name of Object.values(names)) await expect(progress.getByText(name, { exact: true })).toBeVisible();
    await expect(progress.getByText("Fixing a detail")).toBeVisible();
    await expect(progress.getByRole("progressbar", { name: "Ads created" })).toHaveAttribute("aria-valuenow", "6");
    await checkLayout("progress-mid");
    await push({ type: "creative", angleId: "proof", creative: fixture }, stage("proof", "ready"), stage("story", "failed"));
    await expect(progress.getByText(fixture.headline)).toBeVisible();
    await expect(progress.getByText("This ad could not be finished. The other ads carry on.")).toBeVisible();
    await expect(progress.locator('img[src="/solar-example.jpg"]')).toHaveJSProperty("complete", true);
    await checkLayout("progress-late");
    await push({ type: "result", status: 200, body: { variantGroup: "g", creatives: [fixture], failures: [{ angleId: "story" }] } });
    await page.evaluate(() => (window as unknown as CreateStream).__createEnd());
    await expect(page.getByRole("button", { name: "Explore another scene" })).toBeVisible();
    expect(generationBodies).toHaveLength(1);
    expect(generationBodies[0].brief).toBe(edited);
    await expect(page.locator('img[src="/solar-example.jpg"]')).toHaveJSProperty("complete", true);
    expect(await page.locator('img[src="/solar-example.jpg"]').evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await checkLayout("result");
    await page.getByRole("button", { name: "Explore another scene" }).click();
    await page.getByRole("button", { name: /^(Start creating|Edit brief)$/ }).click(); // #1004: a complete Brand offers "Edit brief" to keep the brief review
    await expect(brief).toBeVisible();
    expect(interviewBodies.at(-1)?.referenceBrief).toBe(edited);
    expect(generationBodies).toHaveLength(1);
    const identity = generationBodies[0].generationId as string;
    await page.evaluate(({ identity, edited }) => {
      const key = Object.keys(sessionStorage).find((key) => key.startsWith("adbrain:assistant:"))!;
      const draft = JSON.parse(sessionStorage.getItem(key)!);
      sessionStorage.setItem(key, JSON.stringify({ ...draft, phase: "chat", generationId: identity, prepared: { brief: edited } }));
    }, { identity, edited });
    await page.reload();
    await page.getByRole("button", { name: "Check saved results" }).click();
    await expect(page.getByRole("button", { name: "Explore another scene" })).toBeVisible();
    expect(recoveryIds).toEqual([identity]);
    expect(generationBodies).toHaveLength(1);
    // #1034: on a phone the finished batch's "Make another" must take a real tap (nothing may sit over it).
    await page.getByRole("button", { name: "Make another" }).click();
    await expect(page.getByRole("textbox", { name: "Campaign goal" })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test.beforeAll(async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const email = process.env.DEV_LOGIN_EMAIL;
  const password = process.env.DEV_LOGIN_PASSWORD;
  if (!url || !key || !email || !password) {
    throw new Error("Set local Supabase and DEV_LOGIN_EMAIL/DEV_LOGIN_PASSWORD variables before running workspace browser checks.");
  }
  const client = createServerClient(url, key, {
    cookies: {
      getAll: () => [],
      setAll: (updates) => {
        authCookies = updates.map(({ name, value }) => ({ name, value, domain: "localhost", path: "/", sameSite: "Lax" }));
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error("Local browser-test account sign-in failed.");
});

for (const width of [1440, 1024, 768, 390]) {
  test(`Home to Review at ${width}px`, async ({ page, context }, testInfo) => {
    await context.addCookies(authCookies);
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Next up" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Review ads", exact: true })).toBeVisible();
    expect(await page.evaluate(() => innerWidth)).toBe(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator("aside")).toBeVisible({ visible: width >= 768 });
    for (const image of await page.locator("main img").all()) {
      await image.scrollIntoViewIfNeeded();
      await expect(image).toHaveJSProperty("complete", true);
      expect(await image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    }
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`home-${width}.png`), fullPage: true });

    await page.getByRole("link", { name: "Review ads", exact: true }).click();
    await expect(page).toHaveURL(/\/studio\?status=draft$/);
    await expect(page.getByRole("radio", { name: /Needs review/ })).toBeChecked();
    const board = page.getByRole("region", { name: "Creative board" });
    const inspector = page.getByRole("region", { name: "Creative inspector" });
    const second = board.getByRole("button").nth(1);
    await second.click();
    await expect(second).toHaveAttribute("aria-pressed", "true");
    await expect(inspector.locator("img")).toHaveJSProperty("complete", true);
    expect(await inspector.locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const label of await page.getByRole("list", { name: "Creative workflow" }).locator("li > p:first-of-type").all()) {
      expect(await label.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    const actionRows = await inspector.getByRole("button").evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().top)));
    expect(new Set(actionRows).size).toBe(1);
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`review-${width}.png`), fullPage: true });

    await page.getByRole("searchbox", { name: "Search creatives" }).fill("no-matching-creative-123456");
    await expect(page.getByRole("heading", { name: "No matching creatives" })).toBeVisible();
    await page.getByRole("button", { name: "Clear filters" }).click();
    const preview = inspector.getByTitle("Enlarge creative", { exact: true });
    await preview.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Close preview" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(preview).toBeFocused();

    await page.route("**/api/creatives/generate", async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({ count: 1, format: "square" });
      await route.fulfill({ json: {
        creatives: [{ id: "browser-fixture", business_id: "fixture", brief: "Rooftop assessment", angle: "Value", image_url: "/solar-example.jpg", headline: "Assess your roof", primary_text: "Book a rooftop assessment.", cta: "Book Now", status: "draft", generation: {
          format: "square", composition: "overlay", textModels: [{ provider: "openrouter", model: "paid-text-fixture" }],
          image: { provider: "openrouter-image", model: "paid-image-fixture", estimatedCostUsd: null },
          concept: { rationale: "Use an assessment-led message." },
        } }],
        failures: [{ angle: "Trust", error: "Fixture image unavailable" }],
      } });
    });
    await page.getByText("New creative brief", { exact: true }).click();
    await page.getByLabel("What are we advertising?").fill("Rooftop assessment");
    await page.getByLabel("Variants", { exact: true }).selectOption("1");
    await page.getByLabel("Placement", { exact: true }).selectOption("square");
    await page.getByRole("button", { name: "Generate ads", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Assess your roof" })).toBeVisible();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("1 ads saved; 1 failed");
    await page.getByText("Generation details", { exact: true }).click();
    await expect(page.getByText("openrouter-image: paid-image-fixture", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`generation-${width}.png`), fullPage: true });
    expect(errors).toEqual([]);
  });
}