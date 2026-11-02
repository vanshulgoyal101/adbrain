import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const hook = "./scripts/trusted-server-cli.mjs";
const fixture = "tests/fixtures/server-only-cli.mts";
const tsx = createRequire(import.meta.url).resolve("tsx/cli");
const env: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  SYSTEMROOT: process.env.SYSTEMROOT,
  TMPDIR: process.env.TMPDIR,
  NODE_ENV: "test",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
};

function nodeWithEnv(args: string[], overrides: Partial<NodeJS.ProcessEnv> = {}) {
  return spawnSync(process.execPath, args, { cwd: root, env: { ...env, ...overrides }, encoding: "utf8", timeout: 60_000 });
}

function node(...args: string[]) {
  return nodeWithEnv(args);
}

const testPaymentEnv: Partial<NodeJS.ProcessEnv> = {
  PAYMENTS_TEST_ENABLED: "true",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  RAZORPAY_TEST_KEY_ID: "rzp_test_fixture",
  RAZORPAY_TEST_KEY_SECRET: "synthetic-checkout-secret",
  RAZORPAY_TEST_ACCOUNT_ID: "acc_fixture",
  RAZORPAY_TEST_WEBHOOK_SECRET: "synthetic-webhook-secret",
};
const livePaymentEnv: Partial<NodeJS.ProcessEnv> = {
  NODE_ENV: "production",
  PAYMENTS_LIVE_ENABLED: "true",
  VERCEL_ENV: "production",
  VERCEL_GIT_COMMIT_REF: "main",
  VERCEL_PROJECT_ID: "prj_fixture",
  PAYMENTS_LIVE_PROJECT_ID: "prj_fixture",
  NEXT_PUBLIC_SUPABASE_URL: "https://fixture.supabase.co",
  PAYMENTS_LIVE_SUPABASE_URL: "https://fixture.supabase.co",
  RAZORPAY_LIVE_KEY_ID: "rzp_live_fixture",
  RAZORPAY_LIVE_KEY_SECRET: "synthetic-checkout-secret",
  RAZORPAY_LIVE_ACCOUNT_ID: "acc_fixture",
  RAZORPAY_LIVE_WEBHOOK_SECRET: "synthetic-webhook-secret",
  PAYMENTS_LIVE_WEBHOOK_ID: "33333333-3333-4333-8333-333333333333",
};

const guardedModules = [
  "src/lib/supabase/admin.ts",
  "src/lib/meta/credentials.ts",
  "src/lib/meta/appsecret-proof.ts",
  "src/lib/meta/token-store.ts",
  "src/lib/meta/client.ts",
  "src/lib/payments/production-config.ts",
  "src/lib/payments/razorpay-production.ts",
  "src/lib/payments/razorpay-test.ts",
  "src/lib/payments/razorpay-verification.ts",
  "src/lib/llm/index.ts",
  "src/lib/llm/providers/gemini.ts",
  "src/lib/llm/providers/openai-compatible.ts",
  "src/lib/llm/providers/sdk.ts",
  "src/lib/env.ts",
  "src/lib/imageGen/index.ts",
  "src/lib/imageGen/providers/cloudflare.ts",
  "src/lib/imageGen/providers/openrouter.ts",
  "src/lib/imageGen/providers/pollinations.ts",
];

describe("server-only boundaries", () => {
  it.each(guardedModules)("%s has a side-effect marker", (file) => {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    expect(/^\s*import\s+["']server-only["'];?\s*$/m.test(source)).toBe(true);
  });

  it("loads a marked module in Vitest without executing it", async () => {
    const { createAdminClient } = await import("@/lib/supabase/admin");
    expect(createAdminClient).toBeTypeOf("function");
  });

  it("loads Next config in Vitest's Node environment", async () => {
    const { default: config } = await import("../next.config");
    expect(config.headers).toBeTypeOf("function");
  });

  it("rejects a plain tsx import without the trusted CLI hook", () => {
    const result = node("--import", "tsx", fixture);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("This module cannot be imported from a Client Component module");
  }, 70_000);

  it("loads marked modules through Node and the tsx CLI with the trusted hook", () => {
    for (const args of [
      ["--import", hook, "--import", "tsx", fixture],
      [tsx, "--import", hook, fixture],
    ]) {
      const result = node(...args);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("server-only-cli-ready");
    }
  }, 140_000);

  it.each([
    ["module", 'import "server-only"; process.stdout.write("ok");'],
    ["commonjs", 'require("server-only"); process.stdout.write("ok");'],
  ])("resolves the marker in trusted %s code", (format, code) => {
    const result = node("--import", hook, `--input-type=${format}`, "--eval", code);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("ok");
  }, 70_000);

  it("does not remap unrelated imports", () => {
    const result = node("--import", hook, "--eval",
      'require("node:assert").strictEqual(typeof require("node:fs").readFile, "function"); require("server-only-extra");');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("server-only-extra");
    expect(result.stderr).toContain("MODULE_NOT_FOUND");
  }, 70_000);

  it.each([
    ["disabled", {}, false],
    ["test checkout", testPaymentEnv, true],
    ["live checkout", livePaymentEnv, true],
    ["invalid live checkout", { ...livePaymentEnv, VERCEL_PROJECT_ID: "prj_wrong" }, false],
  ])("loads Next config with %s and restores the marker guard", (_name, overrides, checkoutAllowed) => {
    const code = `
      const config = require("./next.config.ts").default;
      let blocked = false;
      try { require("server-only"); }
      catch (error) {
        if (!String(error.message).includes("This module cannot be imported from a Client Component module")) throw error;
        blocked = true;
      }
      if (!blocked) throw new Error("The server-only hook leaked beyond config loading");
      config.headers().then((routes) => {
        const csp = routes[0].headers.find((header) => header.key === "Content-Security-Policy").value;
        process.stdout.write(JSON.stringify({ checkout: csp.includes("https://checkout.razorpay.com"), blocked }));
      }).catch((error) => { console.error(error); process.exitCode = 1; });
    `;
    const result = nodeWithEnv(["--import", "tsx", "--eval", code], overrides);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ checkout: checkoutAllowed, blocked: true });
  }, 70_000);

  it("keeps the packaged campaign and evaluation commands on the trusted path", () => {
    const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts: Record<string, string>;
    };
    for (const name of ["worker:campaigns", "eval:create"]) {
      expect(manifest.scripts[name]).toContain(`--import ${hook}`);
    }
  });
});
