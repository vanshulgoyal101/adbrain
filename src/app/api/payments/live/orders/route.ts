import { observeRoute } from "@/lib/observability/logger";
import { handleProductionPayments } from "@/lib/payments/production-checkout";

export const runtime = "nodejs";
export const maxDuration = 90;
export const POST = observeRoute("/api/payments/live/orders", "POST", (request: Request) => handleProductionPayments(request, "create"));
export const GET = observeRoute("/api/payments/live/orders", "GET", (request: Request) => handleProductionPayments(request, "read"));