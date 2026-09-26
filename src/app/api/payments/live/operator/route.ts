import { observeRoute } from "@/lib/observability/logger";
import { handleProductionPayments } from "@/lib/payments/production-checkout";

export const runtime = "nodejs";
export const maxDuration = 90;
export const POST = observeRoute("/api/payments/live/operator", "POST", (request: Request) => handleProductionPayments(request, "operator"));
export const GET = observeRoute("/api/payments/live/operator", "GET", (request: Request) => handleProductionPayments(request, "operator"));