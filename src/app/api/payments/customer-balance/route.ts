import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ConnectionAccessError, requireOwnedBusiness } from "@/lib/meta/connection-access";
import { getCustomerBalance, reconcileCustomerCosts, reconcileCustomerRefund, reserveCustomerCampaign } from "@/lib/payments/customer-balance";
import { readStoredCampaignBinding } from "@/lib/campaign/binding";
import { customerCostEvidenceSchema, customerRefundAllocationSchema } from "@/lib/payments/customer-balance-contracts";
import { getProductionPaymentConfig } from "@/lib/payments/production-config";
import { paymentJsonBody, paymentReply } from "@/lib/payments/checkout-request";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { observeRoute } from "@/lib/observability/logger";

export const runtime = "nodejs";

export const GET = observeRoute("/api/payments/customer-balance", "GET", handleGET);
export const POST = observeRoute("/api/payments/customer-balance", "POST", handlePOST);

async function handleGET(request: Request) {
  try {
    const url = new URL(request.url);
    const businessId = z.uuid().parse(url.searchParams.get("businessId"));
    const context = await requireOwnedBusiness(businessId);
    const limited = await rateLimitResponse(`customer-balance:${context.userId}`, { limit: 60, windowMs: 60000 });
    if (limited) return limited;
    const campaignId = url.searchParams.get("campaignId");
    if (campaignId) {
      const database = await createClient();
      const { data: campaign, error } = await database.from("campaigns").select("*")
        .eq("id", z.uuid().parse(campaignId)).eq("business_id", businessId).maybeSingle();
      if (error) throw new ConnectionAccessError("UNAVAILABLE", "Campaign unavailable.");
      if (!campaign) throw new ConnectionAccessError("NOT_FOUND", "Campaign not found.");
      const binding = readStoredCampaignBinding(campaign);
      const reviewed = await reserveCustomerCampaign(context, {
        campaignId, adAccountId: binding.metaAdAccountId!, connectionGeneration: binding.metaConnectionGeneration!,
        dailyBudgetRupees: campaign.daily_budget!, requestKey: "0".repeat(64),
      }, true);
      return Response.json({ balance: reviewed.balance }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ balance: await getCustomerBalance(context) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : error instanceof ConnectionAccessError
      ? ({ UNAUTHENTICATED: 401, NOT_FOUND: 404, FORBIDDEN: 403, CONFLICT: 409, UNAVAILABLE: 503 } as const)[error.code] : 409;
    return paymentReply({ error: "Customer advertising funds are unavailable or require reconciliation." }, status);
  }
}

async function handlePOST(request: Request) {
  try {
    const config = getProductionPaymentConfig();
    if (new URL(request.url).origin !== config.origin || request.headers.get("origin") !== config.origin) return paymentReply({ error: "Same-origin request required." }, 403);
    const { data: { user } } = await (await createClient()).auth.getUser();
    if (!user) return paymentReply({ error: "Sign in required." }, 401);
    const limited = await rateLimitResponse(`customer-accounting:${user.id}`, { limit: 20, windowMs: 300000 });
    if (limited) return limited;
    const input = z.discriminatedUnion("action", [
      z.strictObject({ action: z.literal("costs"), businessId: z.uuid(), evidence: customerCostEvidenceSchema }),
      z.strictObject({ action: z.literal("refund-allocation"), businessId: z.uuid(), allocation: customerRefundAllocationSchema }),
    ]).parse(await paymentJsonBody(request));
    const actor = { businessId: input.businessId, userId: user.id };
    if (input.action === "costs") await reconcileCustomerCosts(actor, input.evidence);
    else await reconcileCustomerRefund(actor, input.allocation);
    return paymentReply({ ok: true });
  } catch (error) {
    return paymentReply({ error: "Approved operator authority and consistent financial evidence are required." }, error instanceof z.ZodError ? 400 : 409);
  }
}