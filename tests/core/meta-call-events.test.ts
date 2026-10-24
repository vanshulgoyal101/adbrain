import { afterEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/meta/advantage-audience-validate.json";
import launchTape from "./fixtures/meta/launch-validate.json";
import type { ProductEventInput } from "@/lib/observability/events";

// #451 L2: every Graph call leaves one product event (endpoint template, method, status, Meta
// code/subcode, latency) and never a token, ID or query value. Replays Meta's recorded answers.

const events = vi.hoisted(() => [] as ProductEventInput[]);
vi.mock("@/lib/observability/logger", () => ({ recordProductEvent: (event: ProductEventInput) => events.push(event) }));
vi.mock("@/lib/security/ssrf", () => ({
  fetchPublicUrl: async () => new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])),
}));

const { MetaClient, MetaError } = await import("@/lib/meta/client");
const { graphEndpoint } = await import("@/lib/meta/graph-event");

type Exchange = { name: string; status: number; body: unknown };
const answer = (name: string) => {
  const exchange = (recorded.tape as unknown as Exchange[]).find((e) => e.name === name)!;
  return Response.json(exchange.body, { status: exchange.status });
};
const inputs = launchTape.inputs;

afterEach(() => {
  vi.restoreAllMocks();
  events.length = 0;
});

describe("core: Meta call events (#451 L2)", () => {
  it("templates endpoints without IDs or query values", () => {
    expect(graphEndpoint("act_1234567890/adsets")).toBe("act_[id]/adsets");
    expect(graphEndpoint("120211234567890123?fields=id,status")).toBe("[id]");
    expect(graphEndpoint("search?type=adinterest&q=Solar")).toBe("search");
    expect(graphEndpoint("1234/insights?time_range={}")).toBe("[id]/insights");
  });

  it("a launch Meta refuses logs each call, the refusal with its recorded code and subcode", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const path = new URL(String(input)).pathname;
      const method = init?.method ?? "GET";
      if (method === "POST" && path.endsWith("/adimages")) return Response.json({ images: { image: { hash: "FEED_HASH" } } });
      if (method === "POST" && path.endsWith("/campaigns")) return answer("campaign-paused");
      if (method === "POST" && path.endsWith("/adsets")) return answer("adset-on-age-25-55");
      if (method === "DELETE") return answer("campaign-delete");
      throw new Error(`Unexpected Graph call ${method} ${path}`);
    });
    const meta = new MetaClient({ adAccountId: "act_ACCOUNT", pageId: "PAGE", accessToken: "secret-token" });
    const launch = meta.createLeadCampaign({
      name: inputs.name, dailyBudgetRupees: inputs.dailyBudgetRupees, link: inputs.link,
      ageMin: inputs.ageMin, ageMax: inputs.ageMax, gender: "all", location: inputs.location,
      creatives: [{ imageUrl: "https://adbrain.vanshul.com/solar-example.jpg", ...inputs.creative }],
      destination: "instant_form", leadFormId: "LEAD_FORM",
    });
    await expect(launch).rejects.toBeInstanceOf(MetaError);

    const graph = events.filter((e) => e.name === "meta.graph");
    expect(graph.length).toBe((vi.mocked(fetch).mock.calls).length);
    expect(graph.find((e) => e.attributes?.route === "act_[id]/campaigns")).toMatchObject({ kind: "system", outcome: "success", attributes: { method: "POST", status: 200, entityType: "campaign" } });
    expect(graph.find((e) => e.attributes?.route === "act_[id]/adsets")).toMatchObject({
      outcome: "rejected", attributes: { method: "POST", status: 400, entityType: "adset", errorCode: "META_100_1870189" },
    });
    for (const event of graph) {
      expect(event.durationMs).toBeGreaterThanOrEqual(0);
      expect(JSON.stringify(event)).not.toMatch(/secret-token|ACCOUNT|PAGE|LEAD_FORM|TEMP_CAMPAIGN|\?/);
    }
  });

  it("a network failure is logged as failed without a status", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    const meta = new MetaClient({ adAccountId: "act_ACCOUNT", pageId: "PAGE", accessToken: "secret-token" });
    await expect(meta.searchGeoLocations("Jaipur")).rejects.toThrow();
    expect(events).toEqual([expect.objectContaining({ name: "meta.graph", outcome: "failed", attributes: expect.objectContaining({ route: "search", method: "GET", errorCode: "META_NETWORK" }) })]);
    expect(events[0].attributes).not.toHaveProperty("status");
  });
});
