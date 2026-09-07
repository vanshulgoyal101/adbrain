import { describe, expect, it } from "vitest";
import {
  apiResultSchema,
  attemptDtoSchema,
  connectionDtoSchema,
  selectedAssetsSchema,
} from "@/lib/meta/connect-contracts";

const businessId = "11111111-1111-4111-8111-111111111111";
const attemptId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const checkedAt = "2026-09-07T00:00:00.000Z";

const assets = {
  metaBusinessId: "business-1",
  adAccountId: "act_123",
  accountName: "Main account",
  pageId: "page-1",
  pageName: "Main Page",
  currency: "INR",
  timezoneName: "Asia/Kolkata",
};

const capabilities = {
  canReadInsights: { state: "available", blockers: [] },
  canReadLeads: { state: "unknown", blockers: [] },
  canCreatePaused: { state: "available", blockers: [] },
  canActivate: { state: "blocked", blockers: [] },
};

describe("Meta connection contracts", () => {
  it("accepts safe success and failure API envelopes", () => {
    const result = apiResultSchema(selectedAssetsSchema).safeParse({
      ok: true,
      data: assets,
      requestId,
    });
    expect(result.success).toBe(true);

    const failure = apiResultSchema(selectedAssetsSchema).safeParse({
      ok: false,
      error: { code: "REAUTH_REQUIRED", message: "Reconnect Meta.", retryable: false },
      requestId,
    });
    expect(failure.success).toBe(true);
  });

  it("rejects unsafe asset identity and non-HTTPS recovery URLs", () => {
    expect(selectedAssetsSchema.safeParse({ ...assets, adAccountId: "123" }).success).toBe(false);
    expect(selectedAssetsSchema.safeParse({ ...assets, currency: "inr" }).success).toBe(false);
  });

  it("rejects selection before complete discovery and mismatched business state", () => {
    const base = {
      attemptId,
      businessId,
      intent: { kind: "setup" as const },
      expiresAt: checkedAt,
      revision: 1,
      state: "selection_required" as const,
      discoveryComplete: false,
      candidates: [],
      connection: null,
      blockers: [],
      retryAfterMs: null,
    };
    expect(attemptDtoSchema.safeParse(base).success).toBe(false);

    const connection = connectionDtoSchema.parse({
      businessId,
      generation: 1,
      authorization: "connected",
      selected: assets,
      capabilities,
      checkedAt,
    });
    expect(
      attemptDtoSchema.safeParse({
        ...base,
        state: "connected",
        discoveryComplete: true,
        connection: { ...connection, businessId: "44444444-4444-4444-8444-444444444444" },
      }).success,
    ).toBe(false);
  });
});