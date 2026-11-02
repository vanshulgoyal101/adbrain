import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pauseTape from "./fixtures/meta/ad-pause.json";
import { MetaClient } from "@/lib/meta/client";

// #1649 (#1648, CTO): the token never rides in a Graph URL or form body. Every call sends it as
// `Authorization: Bearer` with `appsecret_proof` (HMAC-SHA256 of the token with the app secret), so turning on
// Meta's 'Require app secret' makes a stolen token alone useless. Replays Meta's recorded answers.
type Exchange = { method: string; path: string; status: number; body: unknown };
const tape = pauseTape.tape as Exchange[];
const TOKEN = "recorded-user-token";
const SECRET = "fixture-app-secret";
const proof = createHmac("sha256", SECRET).update(TOKEN).digest("hex");

function replay() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    const path = `${url.pathname.replace(/^\/v\d+\.\d+\//, "")}${url.search.replace(/[?&]appsecret_proof=[a-f0-9]+/, "").replace(/^&/, "?")}`;
    const method = init?.method ?? "GET";
    const hit = tape.find((exchange) => exchange.method === method && (method === "POST" ? exchange.path === path : decodeURIComponent(exchange.path) === decodeURIComponent(path)));
    if (!hit) throw new Error(`Unrecorded Graph call ${method} ${path}`);
    return Response.json(hit.body, { status: hit.status });
  });
}

beforeEach(() => vi.stubEnv("META_APP_SECRET", SECRET));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("core: Meta token in a header with appsecret_proof (#1649)", () => {
  it("a read sends the token as a Bearer header and the proof in the query, never the token in the URL", async () => {
    const fetchSpy = replay();
    const meta = new MetaClient({ ...pauseTape.creds, accessToken: TOKEN });
    await expect((meta as unknown as { graph: (path: string) => Promise<unknown> }).graph(tape[0].path)).resolves.toEqual(tape[0].body);
    for (const [input, init] of fetchSpy.mock.calls) {
      const url = String(input);
      expect(url).not.toContain(TOKEN);
      expect(url).not.toContain("access_token");
      expect(new URL(url).searchParams.get("appsecret_proof")).toBe(proof);
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    }
  });

  it("a write sends the token as a Bearer header and the proof in the form, never the token in the body", async () => {
    const fetchSpy = replay();
    const meta = new MetaClient({ ...pauseTape.creds, accessToken: TOKEN });
    const write = tape.find((exchange) => exchange.method === "POST")!;
    await expect((meta as unknown as { graph: (path: string, opts: object) => Promise<unknown> })
      .graph(write.path, { method: "POST", form: { status: "PAUSED", execution_options: "[\"validate_only\"]" } })).resolves.toEqual({ success: true });
    const [input, init] = fetchSpy.mock.calls.at(-1)!;
    const body = init?.body as URLSearchParams;
    expect(String(input)).not.toContain(TOKEN);
    expect(body.get("access_token")).toBeNull();
    expect(body.toString()).not.toContain(TOKEN);
    expect(body.get("appsecret_proof")).toBe(proof);
    expect(body.get("status")).toBe("PAUSED");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
  });

  it("without an app secret configured, still keeps the token out of the URL (header only, no proof)", async () => {
    vi.stubEnv("META_APP_SECRET", "");
    const fetchSpy = replay();
    const meta = new MetaClient({ ...pauseTape.creds, accessToken: TOKEN });
    await (meta as unknown as { graph: (path: string) => Promise<unknown> }).graph(tape[0].path);
    const [input, init] = fetchSpy.mock.calls[0];
    expect(String(input)).not.toMatch(/access_token|appsecret_proof/);
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
  });
});
