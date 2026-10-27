import { afterEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/meta/ad-sources.json";
import { MetaClient } from "@/lib/meta/client";
import { pausedAdIds } from "@/lib/campaign/ad-pause";

// #1055: Meta's real answers (scripts/record-meta-ad-sources.ts, scrubbed): a capped run's ad copy names
// the reviewed ad it came from in `source_ad_id`; the original answers "0".
afterEach(() => vi.restoreAllMocks());

describe("core: an ad paused from the card stays paused on resume (#1055)", () => {
  it("maps a capped copy to its original and an original to itself, with GETs only", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      expect(init?.method ?? "GET").toBe("GET");
      const url = new URL(String(input));
      url.searchParams.delete("access_token");
      const exchange = recorded.tape.find((entry) => entry.path === url.pathname.replace(/^\/v\d+\.\d+\//, "") + url.search);
      if (!exchange) throw new Error(`Unrecorded Graph call: ${url.pathname}`);
      return Response.json(exchange.body, { status: exchange.status });
    });
    const sources = await new MetaClient({ ...recorded.creds, accessToken: "core-token" }).adSources([recorded.copyAdId, recorded.originalAdId]);
    expect(sources).toEqual({ [recorded.copyAdId]: recorded.originalAdId, [recorded.originalAdId]: recorded.originalAdId });
    expect(sources).toEqual(recorded.sources);
  });

  it("keeps paused only the ads whose last card action was a pause", () => {
    expect(pausedAdIds({ adPauses: [
      { adId: "a", action: "paused", at: "1" }, { adId: "b", action: "paused", at: "2" }, { adId: "a", action: "resumed", at: "3" }, { adId: "c", action: "nonsense" }, null,
    ] })).toEqual(["b"]);
    expect(pausedAdIds({})).toEqual([]);
    expect(pausedAdIds(null)).toEqual([]);
  });
});
