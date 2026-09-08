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
