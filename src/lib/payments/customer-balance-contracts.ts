import { z } from "zod";

export const customerPaiseSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const customerBalanceSchema = z.object({
  businessId: z.uuid(), currency: z.literal("INR"), capturedPaise: customerPaiseSchema,
  refundedPaise: customerPaiseSchema, serviceAllocationPaise: customerPaiseSchema, advertisingAllocationPaise: customerPaiseSchema,
  // The ad share refunded (`customer_ad_balance`); optional for older callers, required by the managed spending limit (#522).
  advertisingRefundedPaise: customerPaiseSchema.optional(),
  mediaCostPaise: customerPaiseSchema, taxCostPaise: customerPaiseSchema, reservedPaise: customerPaiseSchema, remainingPaise: customerPaiseSchema,
  held: z.boolean(), reason: z.string().nullable(),
  reservations: z.array(z.object({ campaignId: z.uuid(), reservationId: z.uuid(), state: z.enum(["uncertain", "active", "paused", "closed"]) })).default([]),
});
export type CustomerBalance = z.infer<typeof customerBalanceSchema>;
// #1235 (owner): what reaches the browser. Paid, the service share and the ad-share refund would let a customer work out
// AdBrain's margin by subtraction (devtools or page source), so they stay server-side. Zod drops the omitted keys.
export const customerBalanceViewSchema = customerBalanceSchema.omit({ capturedPaise: true, serviceAllocationPaise: true, advertisingRefundedPaise: true });
export type CustomerBalanceView = z.infer<typeof customerBalanceViewSchema>;
export const toCustomerBalanceView = (balance: CustomerBalance): CustomerBalanceView => customerBalanceViewSchema.parse(balance);

export const customerCostEvidenceSchema = z.strictObject({
  campaignId: z.uuid(), adAccountId: z.string().regex(/^act_[0-9]+$/), connectionGeneration: z.number().int().positive(),
  mediaPaise: customerPaiseSchema, taxPaise: customerPaiseSchema, taxRateBps: z.number().int().min(0).max(10000),
  observedAt: z.iso.datetime(), evidenceReference: z.uuid(), final: z.boolean(), reservationId: z.uuid().nullable(),
});
export const customerRefundAllocationSchema = z.strictObject({
  orderId: z.uuid(), serviceRefundedPaise: customerPaiseSchema.max(200000), advertisingRefundedPaise: customerPaiseSchema.max(800000),
  serviceEarnedPaise: customerPaiseSchema.max(200000), evidenceReference: z.uuid(),
});