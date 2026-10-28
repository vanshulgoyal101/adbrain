import { afterEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/meta/throttle.json";
import { MetaClient, MetaError, MetaThrottledError } from "@/lib/meta/client";

// #1838 (Reviewer, CTO): Meta's throttle is read, not retried. The usage headers' shapes are recorded read-only from a
// real Ads Insights GET (scripts/record-meta-throttle-headers.ts); the throttled values below are set in that shape.
// The code-17 and code-4 bodies are Meta's documented ones (not provoked live).
const creds = { adAccountId: "act_9000000000000001", pageId: "900000000000002", accessToken: "test-token" };
const buc = (minutes: number) => {
  const header = JSON.parse(recorded.headers["x-business-use-case-usage"]) as Record<string, { estimated_time_to_regain_access: number; call_count: number }[]>;
  for (const rows of Object.values(header)) for (const row of rows) { row.estimated_time_to_regain_access = minutes; row.call_count = 100; }
  return JSON.stringify(header);
};
function answer(status: number, body: unknown, headers: Record<string, string> = {}) {
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(body, { status, headers }));
  return fetcher;
}

afterEach(() => vi.restoreAllMocks());

describe("core: Meta throttling is recognised and never retried (#1838)", () => {
  it("code 17 with the business-use-case header: an account-scope throttle with Meta's own wait", async () => {
    const fetcher = answer(400, recorded.error17, { "x-business-use-case-usage": buc(37) });
    const error = await new MetaClient(creds).getCampaignInsights("120000000000000001").catch((reason) => reason);
    expect(error).toBeInstanceOf(MetaThrottledError);
    expect(error).toBeInstanceOf(MetaError);
    expect(error).toMatchObject({ code: 17, reason: "rate_limited", scope: "account", retryAfterMs: 37 * 60_000 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("code 4 is the whole app: app scope, 15 minutes when Meta gives no time", async () => {
    answer(400, recorded.error4);
    const error = await new MetaClient(creds).getCampaignInsights("120000000000000001").catch((reason) => reason);
    expect(error).toMatchObject({ reason: "rate_limited", scope: "app", retryAfterMs: 15 * 60_000 });
  });

  it("the recorded header when not throttled parses to no wait, and an ordinary refusal isn't a throttle", async () => {
    answer(400, { error: { message: "(#100) Invalid parameter", type: "OAuthException", code: 100, fbtrace_id: "x" } }, { "x-business-use-case-usage": recorded.headers["x-business-use-case-usage"] });
    const error = await new MetaClient(creds).getCampaignInsights("120000000000000001").catch((reason) => reason);
    expect(error).toBeInstanceOf(MetaError);
    expect(error).not.toBeInstanceOf(MetaThrottledError);
  });
});
