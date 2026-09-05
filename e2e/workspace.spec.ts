import { expect, test, type BrowserContext } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";

let authCookies: Parameters<BrowserContext["addCookies"]>[0] = [];

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
    const preview = inspector.getByRole("button", { name: /^Preview / });
    await preview.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Close preview" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(preview).toBeFocused();
    expect(errors).toEqual([]);
  });
}