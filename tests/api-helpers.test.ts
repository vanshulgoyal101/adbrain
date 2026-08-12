import { describe, expect, it, vi } from "vitest";
import { apiError, readJson, serverError } from "@/lib/api";

function jsonReq(body: string): Request {
  return new Request("http://localhost/api", { method: "POST", body });
}

describe("readJson", () => {
  it("parses a valid JSON body", async () => {
    const out = await readJson<{ a: number }>(jsonReq('{"a":1}'));
    expect(out).toEqual({ a: 1 });
  });

  it("returns null on invalid JSON", async () => {
    expect(await readJson(jsonReq("not json"))).toBeNull();
  });
});

describe("apiError", () => {
  it("returns the given message and status", async () => {
    const res = apiError("nope", 400);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "nope" });
  });
});

describe("serverError", () => {
  it("logs the real error and returns a generic client message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = serverError("ctx", new Error("secret table detail"), "Failed.");
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Failed.");
    expect(body.error).not.toContain("secret");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
