import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assessMetaFundingSetup, assessMetaProvisioningSetup, assessRecordedMetaFundingSetup, META_FUNDING_METHODS,
  type MetaFundingSetup, type MetaProvisioningSetup, type MetaFundingRecord, type MetaFundingContext,
} from "@/lib/payments/meta-funding";
import { getStoredMetaFundingAssessment } from "@/lib/payments/meta-funding-store";

const storage = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: storage.rpc }) }));

const verifiedSetup: MetaFundingSetup = {
  method: "upi_auto_reload",
  accountId: "act_123",
  expectedOwnerBusinessId: "456",
  ownerBusinessId: "456",
  currency: "INR",
  country: "IN",
  accountActive: true,
  billingMode: "available_funds",
  paymentMethod: "verified",
  recurringAuthorisation: "verified",
  spendControls: "verified",
  ownerAcceptedMetaInitiatedPayments: true,
};

describe("Meta funding setup", () => {
  it("recognises verified India UPI setup without authorising financial operations", () => {
    expect(assessMetaFundingSetup(verifiedSetup)).toEqual({
      setupReady: true, blockers: [], canCollectPayments: false,
      canInitiateTransfers: false, canProvisionAccounts: false,
    });
  });

  it.each(["automatic", "hybrid"] as const)("recognises eligible card billing in %s mode", billingMode => {
    expect(assessMetaFundingSetup({ ...verifiedSetup, method: "recurring_card", billingMode }).setupReady).toBe(true);
  });

  it.each([
    [{ accountActive: false }, "ACCOUNT_INACTIVE"],
    [{ ownerBusinessId: null }, "OWNERSHIP_UNVERIFIED"],
    [{ ownerBusinessId: "789" }, "OWNERSHIP_UNVERIFIED"],
    [{ currency: "USD" }, "UNSUPPORTED_MARKET"],
    [{ country: "US" }, "UNSUPPORTED_MARKET"],
    [{ paymentMethod: "unknown" }, "PAYMENT_METHOD_UNVERIFIED"],
    [{ paymentMethod: "blocked" }, "PAYMENT_METHOD_UNVERIFIED"],
    [{ recurringAuthorisation: "unknown" }, "RECURRING_AUTHORISATION_UNVERIFIED"],
    [{ recurringAuthorisation: "blocked" }, "RECURRING_AUTHORISATION_UNVERIFIED"],
    [{ spendControls: "unknown" }, "SPEND_CONTROLS_UNVERIFIED"],
    [{ spendControls: "blocked" }, "SPEND_CONTROLS_UNVERIFIED"],
    [{ ownerAcceptedMetaInitiatedPayments: false }, "PAYMENT_TIMING_NOT_ACCEPTED"],
    [{ billingMode: "unknown" }, "BILLING_MODE_INCOMPATIBLE"],
    [{ billingMode: "automatic" }, "BILLING_MODE_INCOMPATIBLE"],
    [{ billingMode: "hybrid" }, "BILLING_MODE_INCOMPATIBLE"],
    [{ method: "recurring_card" }, "BILLING_MODE_INCOMPATIBLE"],
    [{ method: "monthly_invoicing" }, "INVOICE_AUTOMATION_UNVERIFIED"],
  ])("blocks incomplete or incompatible evidence %j", (override, blocker) => {
    const result = assessMetaFundingSetup({ ...verifiedSetup, ...override });
    expect(result.setupReady).toBe(false);
    expect(result.blockers).toContain(blocker);
    expect(result.canInitiateTransfers).toBe(false);
  });

  it.each([undefined, null, {}, { funding_source_details: { id: "123" } },
    { ...verifiedSetup, accountId: "123" }, { ...verifiedSetup, method: "prepaid_card_reload" },
    { ...verifiedSetup, ownerAcceptedMetaInitiatedPayments: "true" },
    { ...verifiedSetup, expectedOwnerBusinessId: "" },
  ])("fails closed for malformed setup %j", input => {
    expect(assessMetaFundingSetup(input).blockers).toEqual(["INVALID_SETUP"]);
    expect(assessMetaFundingSetup(input).setupReady).toBe(false);
  });

  it("does not treat a saved funding source as a recurring mandate", () => {
    const result = assessMetaFundingSetup({ ...verifiedSetup, recurringAuthorisation: "unknown", funding_source_details: { id: "123" } });
    expect(result.blockers).toContain("RECURRING_AUTHORISATION_UNVERIFIED");
  });

  it("keeps prepaid account spending limits unavailable", () => {
    expect(META_FUNDING_METHODS.find(method => method.id === "upi_auto_reload")?.accountSpendLimit).toBe("unavailable");
  });
});

const provisioningSetup: MetaProvisioningSetup = {
  portfolioId: "456",
  expectedOwnerBusinessId: "456",
  apiAccess: "verified",
  portfolioStanding: "verified",
  customerConsent: "verified",
  separateCustomerAccount: "verified",
  remainingAccountSlots: 1,
};

describe("Solaride-owned account provisioning setup", () => {
  it("assesses prerequisites without allowing account creation", () => {
    expect(assessMetaProvisioningSetup(provisioningSetup)).toEqual({
      setupReady: true, blockers: [], canProvisionAccounts: false,
    });
  });

  it.each([
    [{ portfolioId: "789" }, "WRONG_PORTFOLIO"],
    [{ apiAccess: "unknown" }, "API_ACCESS_UNVERIFIED"],
    [{ apiAccess: "blocked" }, "API_ACCESS_UNVERIFIED"],
    [{ portfolioStanding: "unknown" }, "PORTFOLIO_STANDING_UNVERIFIED"],
    [{ portfolioStanding: "blocked" }, "PORTFOLIO_STANDING_UNVERIFIED"],
    [{ customerConsent: "unknown" }, "CUSTOMER_CONSENT_UNVERIFIED"],
    [{ customerConsent: "blocked" }, "CUSTOMER_CONSENT_UNVERIFIED"],
    [{ separateCustomerAccount: "unknown" }, "SEPARATE_ACCOUNT_UNVERIFIED"],
    [{ separateCustomerAccount: "blocked" }, "SEPARATE_ACCOUNT_UNVERIFIED"],
    [{ remainingAccountSlots: null, adAccountCreationLimit: 3 }, "CAPACITY_UNVERIFIED"],
    [{ remainingAccountSlots: 0 }, "CAPACITY_EXHAUSTED"],
  ])("rejects unmet prerequisite %j", (override, blocker) => {
    const result = assessMetaProvisioningSetup({ ...provisioningSetup, ...override });
    expect(result.setupReady).toBe(false);
    expect(result.blockers).toContain(blocker);
    expect(result.canProvisionAccounts).toBe(false);
  });

  it.each([undefined, null, {}, { adAccountCreationLimit: 3 },
    { ...provisioningSetup, remainingAccountSlots: -1 },
    { ...provisioningSetup, remainingAccountSlots: 0.5 },
    { ...provisioningSetup, remainingAccountSlots: "3" },
    { ...provisioningSetup, remainingAccountSlots: Infinity },
  ])("fails closed for invalid provisioning data %j", input => {
    expect(assessMetaProvisioningSetup(input).blockers).toEqual(["INVALID_SETUP"]);
  });
});

const fundingRecord: MetaFundingRecord = {
  version: 1,
  businessId: "11111111-1111-4111-8111-111111111111",
  environment: "test",
  connectionGeneration: 3,
  evidenceId: "22222222-2222-4222-8222-222222222222",
  verifiedAt: "2026-09-24T10:00:00Z",
  expiresAt: "2026-09-24T11:00:00Z",
  revokedAt: null,
  setup: verifiedSetup,
};
const fundingContext: MetaFundingContext = {
  businessId: fundingRecord.businessId,
  environment: "test",
  accountId: verifiedSetup.accountId,
  ownerBusinessId: "456",
  connectionGeneration: 3,
  now: "2026-09-24T10:30:00Z",
  maxEvidenceAgeMs: 60 * 60 * 1_000,
};

describe("recorded Meta funding evidence", () => {
  it("accepts current account-bound evidence without enabling live execution", () => {
    expect(assessRecordedMetaFundingSetup(fundingRecord, fundingContext)).toEqual({
      setupReady: true, blockers: [], canCollectPayments: false, canInitiateTransfers: false, canProvisionAccounts: false,
    });
  });

  it.each([
    { businessId: "33333333-3333-4333-8333-333333333333" },
    { environment: "live" },
    { accountId: "act_789" },
    { ownerBusinessId: "789" },
    { connectionGeneration: 4 },
  ])("rejects evidence from a different trusted context %j", override => {
    const result = assessRecordedMetaFundingSetup(fundingRecord, { ...fundingContext, ...override });
    expect(result.setupReady).toBe(false);
    expect(result.blockers).toContain("EVIDENCE_SCOPE_MISMATCH");
  });

  it.each([
    [{ revokedAt: "2026-09-24T10:10:00Z" }, "EVIDENCE_REVOKED"],
    [{ revokedAt: "2026-09-24T12:00:00Z" }, "EVIDENCE_REVOKED"],
    [{ verifiedAt: "2026-09-24T10:31:00Z" }, "EVIDENCE_TIME_INVALID"],
    [{ expiresAt: "2026-09-24T09:59:00Z" }, "EVIDENCE_TIME_INVALID"],
    [{ expiresAt: "2026-09-24T10:00:00Z" }, "EVIDENCE_TIME_INVALID"],
    [{ expiresAt: "2026-09-24T10:30:00Z" }, "EVIDENCE_EXPIRED"],
    [{ expiresAt: "2026-09-24T10:29:59Z" }, "EVIDENCE_EXPIRED"],
  ])("rejects invalidated evidence %j", (override, blocker) => {
    const result = assessRecordedMetaFundingSetup({ ...fundingRecord, ...override }, fundingContext);
    expect(result.setupReady).toBe(false);
    expect(result.blockers).toContain(blocker);
  });

  it("enforces the server freshness policy even if a stored expiry is much later", () => {
    const result = assessRecordedMetaFundingSetup({ ...fundingRecord, expiresAt: "2027-01-01T00:00:00Z" },
      { ...fundingContext, maxEvidenceAgeMs: 30 * 60 * 1_000 });
    expect(result.setupReady).toBe(false);
    expect(result.blockers).toContain("EVIDENCE_EXPIRED");
  });

  it("retains underlying setup blockers despite fresh evidence", () => {
    const result = assessRecordedMetaFundingSetup({ ...fundingRecord,
      setup: { ...verifiedSetup, recurringAuthorisation: "unknown" } }, fundingContext);
    expect(result.setupReady).toBe(false);
    expect(result.blockers).toContain("RECURRING_AUTHORISATION_UNVERIFIED");
  });

  it.each([null, {}, { ...fundingRecord, verifiedAt: "invalid" },
    { ...fundingRecord, version: 2 }, { ...fundingRecord, connectionGeneration: -1 },
    { ...fundingRecord, evidenceId: "untracked screenshot" },
  ])("rejects malformed evidence %j", record => {
    expect(assessRecordedMetaFundingSetup(record, fundingContext).blockers).toEqual(["INVALID_EVIDENCE"]);
  });

  it.each([null, {}, { ...fundingContext, maxEvidenceAgeMs: 0 },
    { ...fundingContext, now: "invalid" }, { ...fundingContext, maxEvidenceAgeMs: Infinity },
  ])("rejects malformed trusted context %j", context => {
    expect(assessRecordedMetaFundingSetup(fundingRecord, context).blockers).toEqual(["INVALID_EVIDENCE"]);
  });
});

describe("stored Meta funding assessment", () => {
  beforeEach(() => { storage.rpc.mockReset(); });

  it("reads the scoped revocation-aware RPC and returns no internal evidence", async () => {
    storage.rpc.mockResolvedValue({ data: fundingRecord, error: null });
    const result = await getStoredMetaFundingAssessment(fundingContext);
    expect(storage.rpc).toHaveBeenCalledExactlyOnceWith("meta_funding_latest_record", {
      p_business_id: fundingContext.businessId, p_environment: "test",
    });
    expect(result.status).toBe("available");
    expect(result.assessment.setupReady).toBe(true);
    expect(result.assessment.canInitiateTransfers).toBe(false);
    expect(result).not.toHaveProperty("record");
    expect(result).not.toHaveProperty("evidenceId");
  });

  it("rejects a bad context before any database access", async () => {
    expect((await getStoredMetaFundingAssessment({ ...fundingContext, businessId: "invalid" })).status).toBe("invalid_context");
    expect(storage.rpc).not.toHaveBeenCalled();
  });

  it.each([
    [{ data: null, error: null }, "missing"],
    [{ data: null, error: { message: "private database error" } }, "unavailable"],
    [{ data: fundingRecord, error: { message: "partial result" } }, "unavailable"],
    [{ data: {}, error: null }, "available"],
    [{ data: { ...fundingRecord, revokedAt: "2026-09-24T10:20:00Z" }, error: null }, "available"],
    [{ data: { ...fundingRecord, environment: "live" }, error: null }, "available"],
  ])("fails closed for storage outcome %j", async (response, status) => {
    storage.rpc.mockResolvedValue(response);
    const result = await getStoredMetaFundingAssessment(fundingContext);
    expect(result.status).toBe(status);
    expect(result.assessment.setupReady).toBe(false);
    expect(result.assessment.canCollectPayments).toBe(false);
    expect(result.assessment.canInitiateTransfers).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private database error");
  });

  it("treats network or configuration failures as unavailable, never ready", async () => {
    storage.rpc.mockRejectedValue(new Error("network unavailable"));
    const result = await getStoredMetaFundingAssessment(fundingContext);
    expect(result.status).toBe("unavailable");
    expect(result.assessment.setupReady).toBe(false);
  });
});