import { createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

// #1324: a recorder can only write to Meta when a person sets ADBRAIN_ALLOW_META_WRITES=1.
async function gatedFetch() {
  vi.resetModules();
  const underlying = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal("fetch", underlying);
  await import("../scripts/lib/meta-write-gate");
  return { underlying, fetch: globalThis.fetch };
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("Meta recorder write gate (#1324)", () => {
  it("is the first import of every Meta recorder", () => {
    const recorders = readdirSync("scripts").filter((name) => /^record-meta-.*\.ts$/.test(name));
    expect(recorders.length).toBeGreaterThan(20);
    for (const name of recorders) {
      const first = readFileSync(`scripts/${name}`, "utf8").split("\n").find((line) => line.startsWith("import "));
      expect(first, name).toBe('import "./lib/meta-write-gate";');
    }
  });

  it("refuses a Graph write without the shell flag and passes reads and other hosts", async () => {
    vi.stubEnv("ADBRAIN_ALLOW_META_WRITES", "");
    const { underlying, fetch } = await gatedFetch();
    await expect(fetch("https://graph.facebook.com/v26.0/act_1/campaigns", { method: "POST" })).rejects.toThrow("ADBRAIN_ALLOW_META_WRITES");
    await expect(fetch("https://graph.facebook.com/v26.0/1", { method: "DELETE" })).rejects.toThrow("ADBRAIN_ALLOW_META_WRITES");
    expect(underlying).not.toHaveBeenCalled();
    await fetch("https://graph.facebook.com/v26.0/act_1?fields=id");
    await fetch("https://example.com/x", { method: "POST" });
    expect(underlying).toHaveBeenCalledTimes(2);
  });

  it("lets a person's run write when the flag is set", async () => {
    vi.stubEnv("ADBRAIN_ALLOW_META_WRITES", "1");
    const { underlying, fetch } = await gatedFetch();
    await fetch("https://graph.facebook.com/v26.0/act_1/ads", { method: "POST" });
    expect(underlying).toHaveBeenCalledTimes(1);
  });

  it("refuses a Graph write in a headless supervisor run even with the flag set (#1513)", async () => {
    vi.stubEnv("ADBRAIN_ALLOW_META_WRITES", "1");
    vi.stubEnv("ADBRAIN_HEADLESS", "1");
    const { underlying, fetch } = await gatedFetch();
    await expect(fetch("https://graph.facebook.com/v26.0/act_1/ads", { method: "POST" })).rejects.toThrow("headless");
    expect(underlying).not.toHaveBeenCalled();
    await fetch("https://graph.facebook.com/v26.0/act_1?fields=id");
    expect(underlying).toHaveBeenCalledTimes(1);
  });
  it("keeps appsecret_proof out of tapes but still sends it to Meta (#1649)", async () => {
    vi.stubEnv("ADBRAIN_ALLOW_META_WRITES", "1");
    vi.stubEnv("META_APP_SECRET", "s3cret");
    const { underlying, fetch } = await gatedFetch();
    // The client adds no proof of its own, so what a recorder captures from MetaClient carries none.
    expect(process.env.META_APP_SECRET).toBeUndefined();
    const proof = (token: string) => createHmac("sha256", "s3cret").update(token).digest("hex");
    const sent = () => new URL((underlying.mock.calls.at(-1) as unknown as [string])[0]).searchParams.get("appsecret_proof");
    await fetch("https://graph.facebook.com/v26.0/act_1/ads", { method: "POST", headers: { Authorization: "Bearer client-token" }, body: new URLSearchParams({ name: "x" }) });
    expect(sent()).toBe(proof("client-token"));
    await fetch("https://graph.facebook.com/v26.0/act_1/ads", { method: "POST", body: new URLSearchParams({ access_token: "form-token" }) });
    expect(sent()).toBe(proof("form-token"));
    await fetch("https://graph.facebook.com/v26.0/1?access_token=query-token", { method: "DELETE" });
    expect(sent()).toBe(proof("query-token"));
    await fetch("https://example.com/x?access_token=t");
    expect(sent()).toBeNull();
  });
});
