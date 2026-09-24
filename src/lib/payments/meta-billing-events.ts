import { z } from "zod";

const referenceSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/);
const paiseSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const metaBillingEventSchema = z.strictObject({
  version: z.literal(1),
  businessId: z.uuid(),
  environment: z.enum(["test", "live"]),
  accountId: z.string().regex(/^act_[0-9]{1,32}$/),
  sourceEventId: referenceSchema,
  chargeId: referenceSchema,
  status: z.enum(["pending", "succeeded", "failed", "reversed"]),
  amountPaise: paiseSchema.refine(amount => amount > 0),
  taxPaise: paiseSchema.nullable(),
  currency: z.literal("INR"),
  occurredAt: z.iso.datetime(),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
}).refine(event => event.taxPaise === null || event.taxPaise <= event.amountPaise);

export type MetaBillingEvent = z.infer<typeof metaBillingEventSchema>;

export const metaChargeContextSchema = z.strictObject({
  businessId: z.uuid(),
  environment: z.enum(["test", "live"]),
  accountId: z.string().regex(/^act_[0-9]{1,32}$/),
  chargeId: referenceSchema,
  now: z.iso.datetime(),
});

export type MetaChargeBlocker = "INVALID_EVIDENCE" | "NO_EVIDENCE" | "SCOPE_MISMATCH"
  | "FUTURE_EVENT" | "EVENT_CONFLICT" | "AMOUNT_CONFLICT" | "STATUS_CONFLICT" | "UNMATCHED_REVERSAL";

export interface MetaChargeAssessment {
  status: "awaiting_provider" | "awaiting_settlement" | "failed" | "needs_reconciliation";
  observedAmountPaise: number | null;
  blockers: MetaChargeBlocker[];
  canCreditCustomerBalance: false;
  canActivateCampaign: false;
  canRetryCharge: false;
}

export function assessMetaCharge(events: unknown, context: unknown): MetaChargeAssessment {
  const parsedEvents = z.array(metaBillingEventSchema).max(1_000).safeParse(events);
  const parsedContext = metaChargeContextSchema.safeParse(context);
  const result: MetaChargeAssessment = {
    status: "needs_reconciliation", observedAmountPaise: null, blockers: [],
    canCreditCustomerBalance: false, canActivateCampaign: false, canRetryCharge: false,
  };
  if (!parsedEvents.success || !parsedContext.success) return { ...result, blockers: ["INVALID_EVIDENCE"] };
  if (!parsedEvents.data.length) return { ...result, blockers: ["NO_EVIDENCE"] };

  const expected = parsedContext.data;
  const blockers = new Set<MetaChargeBlocker>();
  const uniqueEvents = new Map<string, MetaBillingEvent>();
  for (const event of parsedEvents.data) {
    if (event.businessId !== expected.businessId || event.environment !== expected.environment
      || event.accountId !== expected.accountId || event.chargeId !== expected.chargeId) blockers.add("SCOPE_MISMATCH");
    if (Date.parse(event.occurredAt) > Date.parse(expected.now)) blockers.add("FUTURE_EVENT");
    const previous = uniqueEvents.get(event.sourceEventId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(event)) blockers.add("EVENT_CONFLICT");
    uniqueEvents.set(event.sourceEventId, event);
  }

  const observations = [...uniqueEvents.values()];
  const first = observations[0];
  if (observations.some(event => event.amountPaise !== first.amountPaise || event.taxPaise !== first.taxPaise)) blockers.add("AMOUNT_CONFLICT");
  const statuses = new Set(observations.map(event => event.status));
  if (statuses.has("failed") && (statuses.has("succeeded") || statuses.has("reversed"))) blockers.add("STATUS_CONFLICT");
  if (statuses.has("reversed") && !statuses.has("succeeded")) blockers.add("UNMATCHED_REVERSAL");
  if (blockers.size) return { ...result, blockers: [...blockers].sort() };

  return {
    ...result,
    observedAmountPaise: first.amountPaise,
    status: statuses.has("reversed") ? "needs_reconciliation" : statuses.has("succeeded") ? "awaiting_settlement"
      : statuses.has("failed") ? "failed" : "awaiting_provider",
  };
}