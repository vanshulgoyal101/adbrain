import { z } from "zod";

export const META_FUNDING_METHODS = [
  {
    id: "upi_auto_reload",
    name: "UPI auto-reload",
    paymentTiming: "Prepaid balance threshold",
    setup: "UPI mandate authorised in Meta and your UPI app",
    availability: "Supported in India",
    documentationUrl: "https://www.facebook.com/business/help/791384133101786",
    accountSpendLimit: "unavailable",
  },
  {
    id: "recurring_card",
    name: "Automatic card billing",
    paymentTiming: "Billing threshold and monthly bill date",
    setup: "Eligible card and recurring-payment authorisation",
    availability: "Eligible Indian bank and card combinations",
    documentationUrl: "https://www.facebook.com/business/help/3536169639844756",
    accountSpendLimit: "verify_on_account",
  },
  {
    id: "monthly_invoicing",
    name: "Monthly invoicing",
    paymentTiming: "Invoice payment terms",
    setup: "Approved credit arrangement and separate invoice payment route",
    availability: "Meta approval required; India auto-pay unverified",
    documentationUrl: "https://www.facebook.com/business/help/2086865811541431",
    accountSpendLimit: "verify_on_account",
  },
] as const;

export type MetaFundingMethod = typeof META_FUNDING_METHODS[number]["id"];

const verificationSchema = z.enum(["unknown", "verified", "blocked"]);
const fundingSetupSchema = z.object({
  method: z.enum(["upi_auto_reload", "recurring_card", "monthly_invoicing"]),
  accountId: z.string().regex(/^act_[0-9]+$/),
  expectedOwnerBusinessId: z.string().regex(/^[0-9]+$/),
  ownerBusinessId: z.string().regex(/^[0-9]+$/).nullable(),
  currency: z.string(),
  country: z.string(),
  accountActive: z.boolean(),
  billingMode: z.enum(["unknown", "available_funds", "automatic", "hybrid"]),
  paymentMethod: verificationSchema,
  recurringAuthorisation: verificationSchema,
  spendControls: verificationSchema,
  ownerAcceptedMetaInitiatedPayments: z.boolean(),
});

export type MetaFundingSetup = z.infer<typeof fundingSetupSchema>;
export type FundingSetupBlocker =
  | "INVALID_SETUP"
  | "ACCOUNT_INACTIVE"
  | "OWNERSHIP_UNVERIFIED"
  | "UNSUPPORTED_MARKET"
  | "BILLING_MODE_INCOMPATIBLE"
  | "PAYMENT_METHOD_UNVERIFIED"
  | "RECURRING_AUTHORISATION_UNVERIFIED"
  | "SPEND_CONTROLS_UNVERIFIED"
  | "PAYMENT_TIMING_NOT_ACCEPTED"
  | "INVOICE_AUTOMATION_UNVERIFIED";

export interface MetaFundingAssessment {
  setupReady: boolean;
  blockers: FundingSetupBlocker[];
  canCollectPayments: false;
  canInitiateTransfers: false;
  canProvisionAccounts: false;
}

export function assessMetaFundingSetup(input: unknown): MetaFundingAssessment {
  const parsed = fundingSetupSchema.safeParse(input);
  const blockers: FundingSetupBlocker[] = [];

  if (!parsed.success) {
    blockers.push("INVALID_SETUP");
  } else {
    const setup = parsed.data;
    if (!setup.accountActive) blockers.push("ACCOUNT_INACTIVE");
    if (setup.ownerBusinessId !== setup.expectedOwnerBusinessId) blockers.push("OWNERSHIP_UNVERIFIED");
    if (setup.country !== "IN" || setup.currency !== "INR") blockers.push("UNSUPPORTED_MARKET");
    if (setup.paymentMethod !== "verified") blockers.push("PAYMENT_METHOD_UNVERIFIED");
    if (setup.recurringAuthorisation !== "verified") blockers.push("RECURRING_AUTHORISATION_UNVERIFIED");
    if (setup.spendControls !== "verified") blockers.push("SPEND_CONTROLS_UNVERIFIED");
    if (!setup.ownerAcceptedMetaInitiatedPayments) blockers.push("PAYMENT_TIMING_NOT_ACCEPTED");

    if (setup.method === "monthly_invoicing") {
      blockers.push("INVOICE_AUTOMATION_UNVERIFIED");
    } else if (setup.method === "upi_auto_reload" ? setup.billingMode !== "available_funds"
      : !["automatic", "hybrid"].includes(setup.billingMode)) {
      blockers.push("BILLING_MODE_INCOMPATIBLE");
    }
  }

  return {
    setupReady: blockers.length === 0,
    blockers,
    canCollectPayments: false,
    canInitiateTransfers: false,
    canProvisionAccounts: false,
  };
}

export const metaFundingRecordSchema = z.strictObject({
  version: z.literal(1),
  businessId: z.uuid(),
  environment: z.enum(["test", "live"]),
  connectionGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  evidenceId: z.uuid(),
  verifiedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
  setup: fundingSetupSchema,
});

export type MetaFundingRecord = z.infer<typeof metaFundingRecordSchema>;

export const fundingContextSchema = z.strictObject({
  businessId: z.uuid(),
  environment: z.enum(["test", "live"]),
  accountId: z.string().regex(/^act_[0-9]+$/),
  ownerBusinessId: z.string().regex(/^[0-9]+$/),
  connectionGeneration: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  now: z.iso.datetime(),
  maxEvidenceAgeMs: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});

export type MetaFundingContext = z.infer<typeof fundingContextSchema>;
export type RecordedFundingBlocker = FundingSetupBlocker
  | "INVALID_EVIDENCE"
  | "EVIDENCE_SCOPE_MISMATCH"
  | "EVIDENCE_REVOKED"
  | "EVIDENCE_EXPIRED"
  | "EVIDENCE_TIME_INVALID";

export function assessRecordedMetaFundingSetup(record: unknown, context: unknown): Omit<MetaFundingAssessment, "blockers"> & {
  blockers: RecordedFundingBlocker[];
} {
  const parsedRecord = metaFundingRecordSchema.safeParse(record);
  const parsedContext = fundingContextSchema.safeParse(context);
  if (!parsedRecord.success || !parsedContext.success) {
    return { setupReady: false, blockers: ["INVALID_EVIDENCE"], canCollectPayments: false, canInitiateTransfers: false, canProvisionAccounts: false };
  }

  const evidence = parsedRecord.data;
  const expected = parsedContext.data;
  const assessment = assessMetaFundingSetup(evidence.setup);
  const blockers: RecordedFundingBlocker[] = [...assessment.blockers];
  if (evidence.businessId !== expected.businessId || evidence.environment !== expected.environment
    || evidence.connectionGeneration !== expected.connectionGeneration || evidence.setup.accountId !== expected.accountId
    || evidence.setup.expectedOwnerBusinessId !== expected.ownerBusinessId || evidence.setup.ownerBusinessId !== expected.ownerBusinessId) {
    blockers.push("EVIDENCE_SCOPE_MISMATCH");
  }
  if (evidence.revokedAt !== null) blockers.push("EVIDENCE_REVOKED");
  const verifiedAt = Date.parse(evidence.verifiedAt);
  const expiresAt = Date.parse(evidence.expiresAt);
  const now = Date.parse(expected.now);
  if (verifiedAt > now || expiresAt <= verifiedAt) blockers.push("EVIDENCE_TIME_INVALID");
  if (now >= expiresAt || now - verifiedAt >= expected.maxEvidenceAgeMs) blockers.push("EVIDENCE_EXPIRED");

  return { ...assessment, setupReady: blockers.length === 0, blockers };
}

const provisioningSetupSchema = z.object({
  portfolioId: z.string().regex(/^[0-9]+$/),
  expectedOwnerBusinessId: z.string().regex(/^[0-9]+$/),
  apiAccess: verificationSchema,
  portfolioStanding: verificationSchema,
  customerConsent: verificationSchema,
  separateCustomerAccount: verificationSchema,
  remainingAccountSlots: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
});

export type MetaProvisioningSetup = z.infer<typeof provisioningSetupSchema>;
export type ProvisioningSetupBlocker =
  | "INVALID_SETUP"
  | "WRONG_PORTFOLIO"
  | "API_ACCESS_UNVERIFIED"
  | "PORTFOLIO_STANDING_UNVERIFIED"
  | "CUSTOMER_CONSENT_UNVERIFIED"
  | "SEPARATE_ACCOUNT_UNVERIFIED"
  | "CAPACITY_UNVERIFIED"
  | "CAPACITY_EXHAUSTED";

export function assessMetaProvisioningSetup(input: unknown): {
  setupReady: boolean;
  blockers: ProvisioningSetupBlocker[];
  canProvisionAccounts: false;
} {
  const parsed = provisioningSetupSchema.safeParse(input);
  const blockers: ProvisioningSetupBlocker[] = [];
  if (!parsed.success) {
    blockers.push("INVALID_SETUP");
  } else {
    const setup = parsed.data;
    if (setup.portfolioId !== setup.expectedOwnerBusinessId) blockers.push("WRONG_PORTFOLIO");
    if (setup.apiAccess !== "verified") blockers.push("API_ACCESS_UNVERIFIED");
    if (setup.portfolioStanding !== "verified") blockers.push("PORTFOLIO_STANDING_UNVERIFIED");
    if (setup.customerConsent !== "verified") blockers.push("CUSTOMER_CONSENT_UNVERIFIED");
    if (setup.separateCustomerAccount !== "verified") blockers.push("SEPARATE_ACCOUNT_UNVERIFIED");
    if (setup.remainingAccountSlots === null) blockers.push("CAPACITY_UNVERIFIED");
    else if (setup.remainingAccountSlots === 0) blockers.push("CAPACITY_EXHAUSTED");
  }
  return { setupReady: blockers.length === 0, blockers, canProvisionAccounts: false };
}