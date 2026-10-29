import { z } from "zod";
import { ConnectionAccessError, requireOwnedBusiness } from "@/services/business-access";
import { getProductionPaymentConfig } from "@/lib/payments/production-config";
import { paymentJsonBody, paymentReply } from "@/lib/payments/checkout-request";
import { ensurePayLink, isPlanBillingEnabled, PlanNotDueError, readPlan } from "@/lib/plan/store";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { observeRoute } from "@/lib/observability/logger";

export const runtime = "nodejs";

export const GET = observeRoute("/api/payments/plan", "GET", handleGET);
export const POST = observeRoute("/api/payments/plan", "POST", handlePOST);

const statusFor = (error: unknown) => error instanceof z.ZodError ? 400 : error instanceof ConnectionAccessError
  ? ({ UNAUTHENTICATED: 401, NOT_FOUND: 404, FORBIDDEN: 403, CONFLICT: 409, UNAVAILABLE: 503 } as const)[error.code] : 503;

/** #718 slice 2: the owner's ₹999 plan and, when it's time to pay, the month's payment link. */
async function handleGET(request: Request) {
  try {
    const businessId = z.uuid().parse(new URL(request.url).searchParams.get("businessId"));
    const context = await requireOwnedBusiness(businessId);
    const limited = await rateLimitResponse(`plan:${context.userId}`, { limit: 60, windowMs: 60_000 });
    if (limited) return limited;
    if (!isPlanBillingEnabled()) return paymentReply({ plan: null, payUrl: null });
    const { status, payUrl } = await readPlan(businessId);
    return paymentReply({ plan: status, payUrl });
  } catch (error) {
    return paymentReply({ error: "Your plan is unavailable right now." }, statusFor(error));
  }
}

async function handlePOST(request: Request) {
  try {
    const config = getProductionPaymentConfig();
    if (new URL(request.url).origin !== config.origin || request.headers.get("origin") !== config.origin) {
      return paymentReply({ error: "Same-origin request required." }, 403);
    }
    const { businessId } = z.strictObject({ businessId: z.uuid() }).parse(await paymentJsonBody(request));
    const context = await requireOwnedBusiness(businessId);
    const limited = await rateLimitResponse(`plan-pay:${context.userId}`, { limit: 10, windowMs: 300_000 });
    if (limited) return limited;
    if (!isPlanBillingEnabled()) return paymentReply({ error: "Plan payments aren't on yet." }, 404);
    return paymentReply({ payUrl: await ensurePayLink(businessId) });
  } catch (error) {
    if (error instanceof PlanNotDueError) return paymentReply({ error: "Nothing is due yet." }, 409);
    return paymentReply({ error: "Couldn't open the payment page. Try again." }, statusFor(error));
  }
}
