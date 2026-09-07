import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  requireOwnedBusiness: vi.fn(),
  claimConnectionAttempt: vi.fn(),
  attachAttemptToken: vi.fn(),
  markAttemptActionRequired: vi.fn(),
  markAttemptCancelled: vi.fn(),
  markAttemptDiscovering: vi.fn(),
  markAttemptDiscoveryResult: vi.fn(),
  markAttemptFailed: vi.fn(),
  saveEncryptedMetaToken: vi.fn(),
  verifyState: vi.fn(),
  exchangeCodeForToken: vi.fn(),
  exchangeForLongLivedToken: vi.fn(),
  inspectMetaToken: vi.fn(),
  oauthRedirectUri: vi.fn(),
  discoverMetaAssets: vi.fn(),
  metaClientForBusiness: vi.fn(),
  updateCampaignStatus: vi.fn(),
  createLeadCampaign: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: mocks.getUser },
  }),
}));

vi.mock("@/lib/meta/connection-access", () => ({
  requireOwnedBusiness: mocks.requireOwnedBusiness,
}));

vi.mock("@/lib/meta/connection-repository", () => ({
  claimConnectionAttempt: mocks.claimConnectionAttempt,
  attachAttemptToken: mocks.attachAttemptToken,
  markAttemptActionRequired: mocks.markAttemptActionRequired,
  markAttemptCancelled: mocks.markAttemptCancelled,
  markAttemptDiscovering: mocks.markAttemptDiscovering,
  markAttemptDiscoveryResult: mocks.markAttemptDiscoveryResult,
  markAttemptFailed: mocks.markAttemptFailed,
  saveEncryptedMetaToken: mocks.saveEncryptedMetaToken,
}));

vi.mock("@/lib/meta/oauth", () => ({
  verifyState: mocks.verifyState,
  exchangeCodeForToken: mocks.exchangeCodeForToken,
  exchangeForLongLivedToken: mocks.exchangeForLongLivedToken,
  inspectMetaToken: mocks.inspectMetaToken,
  oauthRedirectUri: mocks.oauthRedirectUri,
  discoverMetaAssets: mocks.discoverMetaAssets,
}));

vi.mock("@/lib/meta/credentials", () => ({
  metaClientForBusiness: mocks.metaClientForBusiness,
}));

vi.mock("@/lib/meta/client", () => ({
  MetaClient: vi.fn().mockImplementation(() => ({
    updateCampaignStatus: mocks.updateCampaignStatus,
    createLeadCampaign: mocks.createLeadCampaign,
  })),
}));

vi.mock("@/lib/meta/selection", () => ({
  buildDiscoveryPairs: vi.fn().mockReturnValue([{ pairId: "pair-1" }]),
  buildCandidateDTOs: vi.fn().mockReturnValue([]),
  decideSelection: vi.fn().mockReturnValue({ kind: "choose" }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  mocks.verifyState.mockReturnValue({
    businessId: "business-1",
    userId: "user-1",
    nonce: "nonce-1",
    flow: "instant",
  });
  mocks.requireOwnedBusiness.mockResolvedValue({ businessId: "business-1", userId: "user-1" });
  mocks.claimConnectionAttempt.mockResolvedValue({ attemptId: "attempt-1" });
  mocks.markAttemptCancelled.mockResolvedValue(undefined);
  mocks.markAttemptFailed.mockResolvedValue(undefined);
  mocks.exchangeCodeForToken.mockResolvedValue("short-token");
  mocks.exchangeForLongLivedToken.mockResolvedValue({ accessToken: "long-token", expiresInSec: 3600 });
  mocks.inspectMetaToken.mockResolvedValue({
    metaUserId: "meta-user-1",
    expiresAt: null,
    grantedScopes: ["ads_management"],
  });
  mocks.oauthRedirectUri.mockReturnValue("https://adbrain.example.com/api/meta/oauth/callback");
  mocks.saveEncryptedMetaToken.mockResolvedValue("token-1");
  mocks.discoverMetaAssets.mockResolvedValue({
    complete: true,
    adAccounts: [{ id: "act_1", name: "Account", disabled: false }],
    pages: [{ id: "page_1", name: "Page" }],
  });
});

describe("W2-T11: OAuth completion never activates spending", () => {
  it("stores connection discovery but makes zero campaign activation or creation calls", async () => {
    const { GET } = await import("@/app/api/meta/oauth/callback/route");
    const request = new NextRequest(
      "https://adbrain.example.com/api/meta/oauth/callback?code=oauth-code&state=signed-state",
      { headers: { cookie: "adbrain_meta_binding_nonce-1=browser-binding" } },
    );

    const response = await GET(request);
    const location = response.headers.get("location") ?? "";

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(location).toContain("/connect/meta/complete");
    expect(location).toContain("attemptId=attempt-1");

    expect(mocks.attachAttemptToken).toHaveBeenCalledWith("attempt-1", "token-1");
    expect(mocks.markAttemptDiscoveryResult).toHaveBeenCalledWith(
      "attempt-1",
      expect.objectContaining({ kind: "asset_snapshot", complete: true }),
      "selection_required",
      null,
    );

    expect(mocks.metaClientForBusiness).not.toHaveBeenCalled();
    expect(mocks.updateCampaignStatus).not.toHaveBeenCalled();
    expect(mocks.createLeadCampaign).not.toHaveBeenCalled();
  });

  it("redirects without campaign calls when OAuth provider returns an error", async () => {
    const { GET } = await import("@/app/api/meta/oauth/callback/route");
    const request = new NextRequest(
      "https://adbrain.example.com/api/meta/oauth/callback?error=access_denied&state=signed-state",
      { headers: { cookie: "adbrain_meta_binding_nonce-1=browser-binding" } },
    );

    const response = await GET(request);
    const location = response.headers.get("location") ?? "";

    expect(location).toContain("error=oauth_cancelled");
    expect(mocks.markAttemptCancelled).toHaveBeenCalledWith("attempt-1");
    expect(mocks.metaClientForBusiness).not.toHaveBeenCalled();
    expect(mocks.updateCampaignStatus).not.toHaveBeenCalled();
    expect(mocks.createLeadCampaign).not.toHaveBeenCalled();
  });
});