import { observeRoute } from "@/lib/observability/logger";
import { handleTestPayments } from "@/lib/payments/test-checkout";

export const runtime = "nodejs";
export const maxDuration = 60;
export const POST = observeRoute("/api/payments/test/webhook", "POST", (request: Request) => handleTestPayments(request, "webhook"));