import { expect, test } from "@playwright/test";

// #458: while logged out, /ideas prefetches the "Make one like this" link to /create and the proxy
// answers that prefetch with 307 → /login. After a password sign-in the owner must land on Create
// with the idea's goal, not stay on "Create your free account".
test("password sign-in after 'Make one like this' lands on Create with the idea's goal", async ({ page, context }) => {
  const email = process.env.DEV_LOGIN_EMAIL;
  const password = process.env.DEV_LOGIN_PASSWORD;
  test.skip(!email || !password, "DEV_LOGIN_EMAIL and DEV_LOGIN_PASSWORD are required");
  // Read-only apart from the sign-in itself.
  await context.route("**/*", (route) => {
    const request = route.request();
    if (request.method() === "POST" && new URL(request.url()).pathname === "/auth/v1/token") return route.continue();
    return ["GET", "HEAD", "OPTIONS"].includes(request.method()) ? route.continue() : route.abort();
  });

  const prefetched = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/create" && url.searchParams.has("_rsc");
  }, { timeout: 20_000 });
  await page.goto("/ideas/rooftop-solar");
  const makeOne = page.getByRole("link", { name: /make one like this/i });
  await makeOne.hover();
  await prefetched;
  await makeOne.click();
  await expect(page).toHaveURL(/\/login\?redirect=%2Fcreate$/);

  await page.waitForLoadState("load");
  const passwordField = page.getByLabel("Password", { exact: true });
  await expect(async () => {
    if (!(await passwordField.isVisible())) await page.getByRole("button", { name: "I have a password" }).click();
    await expect(passwordField).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await page.getByLabel("Email", { exact: true }).fill(email!);
  await passwordField.fill(password!);
  await page.getByRole("button", { name: "Sign in with password", exact: true }).click();

  await expect(page).toHaveURL(/\/create$/, { timeout: 15_000 });
  await expect(page.getByRole("textbox", { name: "Campaign goal" })).toHaveValue(/free site survey/i);
});
