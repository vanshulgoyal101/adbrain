import { observeRoute } from "@/lib/observability/logger";
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

/** Begin the Facebook-Login connect flow: redirect the owner to Meta's dialog. */
export const GET = observeRoute("/api/meta/oauth/start", "GET", handleGET);

async function handleGET(request: NextRequest) {
  const settings = new URL("/settings", request.url);
  settings.searchParams.set("meta_error", "use_contextual_connect");
  return NextResponse.redirect(settings);
}
