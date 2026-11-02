import type { AttemptDTO, ConnectionDTO } from "@/lib/meta/connect-contracts";

export const businessId = "11111111-1111-4111-8111-111111111111";
const checkedAt = "2026-09-07T00:00:00.000Z";
const assets = {
  metaBusinessId: "meta-business-1",
  adAccountId: "act_123456",
  accountName: "Growth account",
  pageId: "page-123",
  pageName: "Vanshul Clinic",
  currency: "INR",
  timezoneName: "Asia/Kolkata",
} as const;

const capabilities = {
  canReadInsights: { state: "available", blockers: [] },
  canReadLeads: { state: "available", blockers: [] },
  canCreatePaused: { state: "available", blockers: [] },
  canActivate: { state: "available", blockers: [] },
} as const;

export const disconnectedUnknown: ConnectionDTO = {
  businessId,
  generation: 0,
  authorization: "disconnected",
  selected: null,
  capabilities: {
    canReadInsights: { state: "unknown", blockers: [] },
    canReadLeads: { state: "unknown", blockers: [] },
    canCreatePaused: { state: "unknown", blockers: [] },
    canActivate: { state: "unknown", blockers: [] },
  },
  checkedAt: null,
};

export const connected: ConnectionDTO = {
  businessId,
  generation: 3,
  authorization: "connected",
  selected: assets,
  capabilities,
  checkedAt,
};

export const connectedAttemptForActivation: AttemptDTO = {
  attemptId: "22222222-2222-4222-8222-222222222222",
  businessId,
  intent: { kind: "review_activation", campaignId: "44444444-4444-4444-8444-444444444444" },
  expiresAt: "2026-09-07T01:00:00.000Z",
  revision: 2,
  state: "connected",
  discoveryComplete: true,
  candidates: [],
  connection: connected,
  blockers: [],
  retryAfterMs: null,
};

