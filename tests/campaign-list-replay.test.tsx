// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCampaignList } from "@/lib/meta-connect-ui/use-campaign-list";
import type { Campaign } from "@/lib/types";

// #1003 (CTO): after Pause the owner went to Home and came back; the browser's back replayed the first
// render (Running) and nothing read the list again until a reload.
const running = { id: "c1", status: "active" } as Campaign;
// One server render's props: the same objects on every re-render, as React passes them.
const renders = new Map<string, Parameters<typeof useCampaignList>[0]>();
const list = (renderId: string) => {
  if (!renders.has(renderId)) renders.set(renderId, { ownerId: "o1", businessId: "b1", initialCampaigns: [running], initialResults: {}, initialNextCursor: null, renderId, onError: vi.fn() });
  return renders.get(renderId)!;
};

afterEach(() => vi.unstubAllGlobals());

describe("campaign list on a replayed page (#1003)", () => {
  it("reads the list again only when a render it already showed comes back", async () => {
    const fetchMock = vi.fn(async () => Response.json({ campaigns: [{ ...running, status: "paused" }], results: {}, nextCursor: null }));
    vi.stubGlobal("fetch", fetchMock);
    const first = renderHook(() => useCampaignList(list("render-1")));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(first.result.current.campaigns[0].status).toBe("active");
    first.unmount();

    const replay = renderHook(() => useCampaignList(list("render-1")));
    await waitFor(() => expect(replay.result.current.campaigns[0].status).toBe("paused"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toMatch(/^\/api\/campaigns\/list\?businessId=b1/);
    replay.unmount();

    renderHook(() => useCampaignList(list("render-2")));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
