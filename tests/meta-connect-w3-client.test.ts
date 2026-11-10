import { describe, expect, it, vi } from "vitest";
import { createMetaConnectClient, MetaConnectClientError } from "@/lib/meta-connect-ui/client";
import { businessId, connected } from "./fixtures/meta-connect-w3";

const requestId = "33333333-3333-4333-8333-333333333333";

describe("Meta connect browser client", () => {
  it("validates same-origin status responses", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: connected, requestId }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    const client = createMetaConnectClient({ fetchImpl });

    await expect(client.status(businessId)).resolves.toEqual(connected);
    expect(fetchImpl).toHaveBeenCalledWith(
      `/api/meta/connections/status?businessId=${businessId}`,
      expect.objectContaining({ credentials: "same-origin", cache: "no-store" }),
    );
  });

  it("fails closed on malformed data and preserves abort signals", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: { authorization: "connected" }, requestId })),
    );
    const client = createMetaConnectClient({ fetchImpl });
    await expect(client.status(businessId)).rejects.toBeInstanceOf(MetaConnectClientError);

    const controller = new AbortController();
    await client.status(businessId, controller.signal).catch(() => undefined);
    expect(fetchImpl.mock.calls.at(-1)?.[1]).toEqual(
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("reads account tracking with the selected business and an explicit fresh check", async () => {
    const controller = new AbortController();
    const tracking = {
      businessId, connectionGeneration: 3,
      binding: { adAccountId: connected.selected!.adAccountId, pageId: connected.selected!.pageId },
      status: {
        state: "quiet", unreadable: null, pixelId: "9000000000000004",
        pixels: [{ id: "9000000000000004", name: "Site", lastFiredAt: null, unavailable: false }],
        window: { since: "2026-10-26T16:00:00+0000", until: "2026-11-02T16:00:00+0000" },
        lastSeenAt: null, counts: { Lead: 0, Purchase: 0 }, totalEvents: 0,
      },
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: tracking, requestId })),
    );
    const client = createMetaConnectClient({ fetchImpl });
    await expect(client.trackingStatus(connected, { fresh: true, signal: controller.signal })).resolves.toEqual(tracking);
    expect(fetchImpl).toHaveBeenCalledWith(
      `/api/meta/tracking?businessId=${businessId}&fresh=1`,
      expect.objectContaining({ credentials: "same-origin", cache: "no-store", signal: controller.signal }),
    );
  });

  it("rejects tracking responses for a different business or with malformed counts", async () => {
    const tracking = {
      businessId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", connectionGeneration: 3,
      binding: { adAccountId: connected.selected!.adAccountId, pageId: connected.selected!.pageId },
      status: { state: "none", unreadable: null, pixelId: null, pixels: [], window: null, lastSeenAt: null, counts: null, totalEvents: null },
    };
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: tracking, requestId })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: {
        ...tracking, businessId, status: { ...tracking.status, counts: { Lead: -1, Purchase: 0 } },
      }, requestId })));
    const client = createMetaConnectClient({ fetchImpl });
    await expect(client.trackingStatus(connected)).rejects.toBeInstanceOf(MetaConnectClientError);
    await expect(client.trackingStatus(connected)).rejects.toBeInstanceOf(MetaConnectClientError);
  });

  it.each([
    { connectionGeneration: 4 },
    { binding: { adAccountId: "act_987654", pageId: connected.selected!.pageId } },
    { binding: { adAccountId: connected.selected!.adAccountId, pageId: "other-page" } },
  ])("rejects another connection binding, even at the same generation: %j", async (changes) => {
    const tracking = {
      businessId, connectionGeneration: 3,
      binding: { adAccountId: connected.selected!.adAccountId, pageId: connected.selected!.pageId },
      status: { state: "none", unreadable: null, pixelId: null, pixels: [], window: null, lastSeenAt: null, counts: null, totalEvents: null },
      ...changes,
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: tracking, requestId })),
    );
    await expect(createMetaConnectClient({ fetchImpl }).trackingStatus(connected)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it.each([
    { state: "none", unreadable: "list_failed" },
    { state: "ready", unreadable: null },
    { state: "unreadable", unreadable: null },
    { state: "quiet", unreadable: null, counts: { Lead: 2, Purchase: 0 }, totalEvents: 2 },
  ])("rejects a contradictory tracking state: %j", async (changes) => {
    const tracking = {
      businessId, connectionGeneration: 3,
      binding: { adAccountId: connected.selected!.adAccountId, pageId: connected.selected!.pageId },
      status: {
        pixelId: null, pixels: [], window: null, lastSeenAt: null,
        counts: null, totalEvents: null, ...changes,
      },
    };
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, data: tracking, requestId })),
    );
    await expect(createMetaConnectClient({ fetchImpl }).trackingStatus(connected)).rejects.toBeInstanceOf(MetaConnectClientError);
  });

  it("sends the frozen DraftInput envelope before a prepare intent", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        data: {
          draftId: "66666666-6666-4666-8666-666666666666",
          version: 1,
          expiresAt: "2026-09-08T00:00:00.000Z",
          input: {
            businessId,
            name: "Clinic leads",
            goal: "Book consultations",
            mode: "manual",
            creativeIds: [],
            dailyBudgetRupees: 500,
            leadFormId: null,
            targeting: {},
            abTest: false,
          },
        },
        requestId,
      })),
    );
    const client = createMetaConnectClient({ fetchImpl });
    const input = {
      businessId,
      name: "Clinic leads",
      goal: "Book consultations",
      mode: "manual" as const,
      creativeIds: [],
      dailyBudgetRupees: 500,
      leadFormId: null,
      targeting: {},
      abTest: false,
    };

    await expect(client.saveDraft(input)).resolves.toMatchObject({ version: 1 });
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/campaign-drafts",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify(input),
      }),
    );
  });

  it("sends explicit replacement confirmation for candidate selection", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        data: {
          attemptId: "22222222-2222-4222-8222-222222222222",
          businessId,
          intent: { kind: "setup" },
          expiresAt: "2026-09-08T00:00:00.000Z",
          revision: 2,
          state: "connected",
          discoveryComplete: true,
          candidates: [],
          connection: connected,
          blockers: [],
          retryAfterMs: null,
        },
        requestId,
      })),
    );
    const client = createMetaConnectClient({ fetchImpl });

    await client.select("22222222-2222-4222-8222-222222222222", "pair-2", 1, true);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/meta/connections/attempts/22222222-2222-4222-8222-222222222222/select",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ pairId: "pair-2", revision: 1, confirmReplacement: true }),
      }),
    );
  });

  it("retries an owned attempt with its current revision", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        data: {
          attemptId: "22222222-2222-4222-8222-222222222222",
          businessId,
          intent: { kind: "setup" },
          expiresAt: "2026-09-08T00:00:00.000Z",
          revision: 3,
          state: "discovering",
          discoveryComplete: false,
          candidates: [],
          connection: null,
          blockers: [],
          retryAfterMs: 1000,
        },
        requestId,
      })),
    );
    const client = createMetaConnectClient({ fetchImpl });

    await client.retry("22222222-2222-4222-8222-222222222222", 2);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/meta/connections/attempts/22222222-2222-4222-8222-222222222222/retry",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ revision: 2 }),
      }),
    );
  });
});
