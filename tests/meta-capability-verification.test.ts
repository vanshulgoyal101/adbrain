import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyMetaCapabilities } from "@/lib/meta/capability-verification";

const selected = { metaBusinessId: null, adAccountId: "act_123", accountName: "Account", pageId: "456", pageName: "Page", currency: "INR", timezoneName: "Asia/Kolkata" };
function provider(options: { funded?: boolean; tasks?: string[]; fail?: boolean; missingPageToken?: boolean } = {}) {
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    expect(init.method).toBe("GET");
    expect(url).not.toContain("fixture-token");
    if (options.fail) return Response.json({}, { status: 503 });
    if (url.includes("456?fields=access_token")) return Response.json(options.missingPageToken ? {} : { access_token: "fixture-page-token" });
    if (url.includes("/leadgen_forms")) {
      expect(init.headers).toEqual({ Authorization: "Bearer fixture-page-token" });
      expect(url).not.toContain("fixture-page-token");
      return Response.json({ data: [] });
    }
    if (url.includes("me/permissions")) return Response.json({ data: ["ads_management", "pages_manage_ads", "leads_retrieval", "pages_read_engagement"].map(permission => ({ permission, status: "granted" })) });
    if (url.includes("me/accounts")) return Response.json({ data: [{ id: "456", tasks: options.tasks ?? ["ADVERTISE"] }] });
    if (url.includes("act_123?")) return Response.json({ id: "act_123", account_status: 1, currency: "INR", timezone_name: "Asia/Kolkata", user_tasks: options.tasks ?? ["ADVERTISE"], funding_source_details: options.funded ? { id: "billing-1" } : null });
    return Response.json({ data: [] });
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
afterEach(() => vi.unstubAllGlobals());
describe("read-only Meta capability verification", () => {
  it("bootstraps capabilities using only provider GET evidence", async () => {
    const fetcher = provider({ funded: true });
    const result = await verifyMetaCapabilities("fixture-token", selected);
    expect(Object.values(result).every(capability => capability.state === "available")).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(6);
  });
  it("keeps lead access unknown without a Page token and does not fall back to the account token", async () => {
    const fetcher = provider({ funded: true, missingPageToken: true });
    const result = await verifyMetaCapabilities("fixture-token", selected);
    expect(result.canReadLeads.state).toBe("unknown");
    expect(result.canReadInsights.state).toBe("available");
    expect(fetcher.mock.calls.some(([url]) => url.includes("/leadgen_forms"))).toBe(false);
  });
  it("allows paused creation but not activation without billing evidence", async () => {
    provider();
    const result = await verifyMetaCapabilities("fixture-token", selected);
    expect(result.canCreatePaused.state).toBe("available");
    expect(result.canActivate.blockers[0].code).toBe("BILLING_REQUIRED");
  });
  it("does not infer advertising rights from content creation", async () => {
    provider({ funded: true, tasks: ["CREATE_CONTENT"] });
    expect((await verifyMetaCapabilities("fixture-token", selected)).canCreatePaused.state).toBe("blocked");
  });
  // #1217: a Meta that didn't answer isn't a missing permission; nothing is saved and the owner can try again.
  it("#1217: when Meta doesn't answer (every read 5xx, even after one repeat), it says so instead of returning 'unknown'", async () => {
    const fetcher = provider({ fail: true });
    await expect(verifyMetaCapabilities("fixture-token", selected)).rejects.toMatchObject({ name: "ConnectionAccessError", code: "UNAVAILABLE", retryable: true, message: "Meta didn't answer. Try again." });
    expect(fetcher.mock.calls.filter(([url]) => url.includes("me/permissions"))).toHaveLength(2);
  });

  it("#1217: repeats a read once after a 5xx or a network error, so one blip doesn't block activation", async () => {
    for (const blip of [() => Response.json({}, { status: 500 }), () => { throw new TypeError("fetch failed"); }]) {
      const fetcher = provider({ funded: true });
      const answer = fetcher.getMockImplementation()!;
      let first = true;
      fetcher.mockImplementation(async (url: string, init: RequestInit) => {
        if (url.includes("me/permissions") && first) { first = false; return blip(); }
        return answer(url, init);
      });
      const result = await verifyMetaCapabilities("fixture-token", selected);
      expect(result.canActivate.state).toBe("available");
      expect(fetcher.mock.calls.filter(([url]) => url.includes("me/permissions"))).toHaveLength(2);
      vi.unstubAllGlobals();
    }
  });

  it("#1217: a timeout isn't repeated (the activation route has no deadline), but still isn't saved as 'unknown'", async () => {
    const fetcher = provider({ funded: true });
    const answer = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.includes("me/permissions")) throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      return answer(url, init);
    });
    await expect(verifyMetaCapabilities("fixture-token", selected)).rejects.toMatchObject({ code: "UNAVAILABLE", retryable: true });
    expect(fetcher.mock.calls.filter(([url]) => url.includes("me/permissions"))).toHaveLength(1);
  });

  it("#1217: the ad account read not answering also says 'try again' (it would leave create/activate unknown)", async () => {
    const fetcher = provider({ funded: true });
    const answer = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string, init: RequestInit) => url.includes("act_123?") ? Response.json({}, { status: 502 }) : answer(url, init));
    await expect(verifyMetaCapabilities("fixture-token", selected)).rejects.toMatchObject({ code: "UNAVAILABLE", retryable: true });
  });

  it("#1217: a real refusal (4xx) is still an answer: the capability stays unknown/blocked, not 'try again'", async () => {
    const fetcher = provider({ funded: true });
    const answer = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (url: string, init: RequestInit) => url.includes("/insights") ? Response.json({ error: { code: 10 } }, { status: 403 }) : answer(url, init));
    const result = await verifyMetaCapabilities("fixture-token", selected);
    expect(result.canReadInsights.state).toBe("unknown");
    expect(result.canActivate.state).toBe("available");
    expect(fetcher.mock.calls.filter(([url]) => url.includes("/insights"))).toHaveLength(1);
  });
});