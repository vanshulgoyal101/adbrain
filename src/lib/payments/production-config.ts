import { createHash } from "node:crypto";
import { z } from "zod";

type Environment = Readonly<Record<string, string | undefined>>;

export class ProductionPaymentError extends Error {
  constructor(readonly code: "DISABLED" | "COLLECTION_BLOCKED" | "PROVIDER_UNAVAILABLE" | "INVALID_PROVIDER_RESPONSE") {
    super(code === "DISABLED" ? "Live payments are disabled."
      : code === "COLLECTION_BLOCKED" ? "Collection requires an approved current commercial policy."
        : "Payment provider state is unconfirmed. Reconcile the existing operation before retrying.");
    this.name = "ProductionPaymentError";
  }
}

const identifier = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9]{1,100}$`));
const configSchema = z.object({
  RAZORPAY_LIVE_KEY_ID: z.string().regex(/^rzp_live_[A-Za-z0-9]{1,100}$/),
  RAZORPAY_LIVE_KEY_SECRET: z.string().trim().min(16),
  RAZORPAY_LIVE_ACCOUNT_ID: identifier("acc"),
  RAZORPAY_LIVE_WEBHOOK_SECRET: z.string().trim().min(16),
  PAYMENTS_LIVE_WEBHOOK_ID: z.uuid(),
  PAYMENTS_LIVE_PROJECT_ID: identifier("prj"),
  PAYMENTS_LIVE_SUPABASE_URL: z.url(),
});

export function getProductionPaymentConfig(environment: Environment = process.env) {
  const parsed = configSchema.safeParse(environment);
  if (typeof window !== "undefined" || !parsed.success || environment.PAYMENTS_LIVE_ENABLED !== "true"
    || environment.NODE_ENV !== "production" || environment.VERCEL_ENV !== "production"
    || (environment.VERCEL_TARGET_ENV && environment.VERCEL_TARGET_ENV !== "production")
    || environment.VERCEL_GIT_COMMIT_REF !== "main"
    || environment.PAYMENTS_TEST_ENABLED === "true"
    || ["RAZORPAY_TEST_KEY_ID", "RAZORPAY_TEST_KEY_SECRET", "RAZORPAY_TEST_ACCOUNT_ID", "RAZORPAY_TEST_WEBHOOK_SECRET"]
      .some(name => Boolean(environment[name]))) throw new ProductionPaymentError("DISABLED");
  const settings = parsed.data;
  const database = new URL(settings.PAYMENTS_LIVE_SUPABASE_URL);
  if (database.protocol !== "https:" || !/^[a-z0-9-]+\.supabase\.co$/.test(database.hostname)
    || database.port || database.username || database.password || database.pathname !== "/" || database.search || database.hash
    || environment.NEXT_PUBLIC_SUPABASE_URL !== settings.PAYMENTS_LIVE_SUPABASE_URL
    || environment.VERCEL_PROJECT_ID !== settings.PAYMENTS_LIVE_PROJECT_ID
    || settings.RAZORPAY_LIVE_KEY_SECRET === settings.RAZORPAY_LIVE_WEBHOOK_SECRET
    || ((environment.RAZORPAY_KEY_ID || environment.RAZORPAY_KEY_SECRET)
      && (environment.RAZORPAY_KEY_ID !== settings.RAZORPAY_LIVE_KEY_ID || environment.RAZORPAY_KEY_SECRET !== settings.RAZORPAY_LIVE_KEY_SECRET))) {
    throw new ProductionPaymentError("DISABLED");
  }
  return Object.freeze({
    environment: "live" as const,
    origin: "https://adbrain.vanshul.com",
    keyId: settings.RAZORPAY_LIVE_KEY_ID,
    keySecret: settings.RAZORPAY_LIVE_KEY_SECRET,
    accountId: settings.RAZORPAY_LIVE_ACCOUNT_ID,
    webhookId: settings.PAYMENTS_LIVE_WEBHOOK_ID,
    webhookSecret: settings.RAZORPAY_LIVE_WEBHOOK_SECRET,
  });
}

const policyText = z.string().trim().min(1).max(8_000);

export function isProductionPaymentConfigured(): boolean {
  try { getProductionPaymentConfig(); return true; }
  catch { return false; }
}

export const OPERATOR_MANAGED_POLICY = Object.freeze({
  version: "operator-managed-v1",
  fundingMode: "operator_managed",
  approvalReference: "https://github.com/vanshulgoyal101/adbrain/issues/48#issuecomment-5848530300",
  approvedAt: "2026-09-26T17:58:20Z",
  serviceScope: "INR 10,000 total for 12 months for one business, one offer and one service area, including up to two creatives and one capped Meta campaign. INR 2,000 is allocated to service and INR 8,000 to advertising including applicable Meta taxes. AdBrain absorbs gateway fees. No extra checkout charge, automatic renewal, year-round ad delivery or guaranteed results. The operator pays Meta separately; payment to AdBrain is not confirmation of a transfer to Meta or permission to activate ads.",
  invoiceTerms: "The invoice will reflect Vanshul Goyal's actual tax status and applicable law. This payment receipt is not a tax invoice and makes no GST-registration claim. No additional checkout charge applies. Mandatory customer rights remain applicable.",
  refundTerms: "Full refund before work starts. After work starts, unused advertising allocation is refundable after pending costs are reconciled. The INR 2,000 service allocation is earned only after the agreed creatives and campaign setup are delivered; otherwise it remains refundable. Mandatory customer rights remain applicable.",
} as const);

const legacyPaymentPolicySchema = z.strictObject({
  version: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).refine(value => value !== OPERATOR_MANAGED_POLICY.version),
  approvalReference: z.uuid(),
  approvedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  serviceScope: policyText,
  invoiceTerms: policyText,
  refundTerms: policyText,
  automaticFundingApprovalReference: z.uuid(),
});

export const productionPaymentPolicySchema = z.union([z.strictObject({
  version: z.literal(OPERATOR_MANAGED_POLICY.version), fundingMode: z.literal(OPERATOR_MANAGED_POLICY.fundingMode),
  approvalReference: z.literal(OPERATOR_MANAGED_POLICY.approvalReference), approvedAt: z.literal(OPERATOR_MANAGED_POLICY.approvedAt),
  serviceScope: z.literal(OPERATOR_MANAGED_POLICY.serviceScope), invoiceTerms: z.literal(OPERATOR_MANAGED_POLICY.invoiceTerms),
  refundTerms: z.literal(OPERATOR_MANAGED_POLICY.refundTerms),
}), legacyPaymentPolicySchema]);

export function getProductionCollectionPolicy(environment: Environment = process.env, now = Date.now()) {
  getProductionPaymentConfig(environment);
  try {
    const raw = environment.PAYMENTS_LIVE_POLICY_JSON || JSON.stringify(OPERATOR_MANAGED_POLICY);
    if (environment.PAYMENTS_LIVE_COLLECTION_ENABLED !== "true" || !raw || raw.length > 32_768 || !Number.isFinite(now)) {
      throw new Error();
    }
    const policy = productionPaymentPolicySchema.parse(JSON.parse(raw));
    if (Date.parse(policy.approvedAt) > now || ("expiresAt" in policy && Date.parse(policy.expiresAt) <= now)) throw new Error();
    return Object.freeze({
      ...policy,
      hash: createHash("sha256").update(JSON.stringify(policy)).digest("hex"),
    });
  } catch {
    throw new ProductionPaymentError("COLLECTION_BLOCKED");
  }
}