import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

/** Begin the Facebook-Login connect flow: redirect the owner to Meta's dialog. */
export async function GET(request: NextRequest) {
  const settings = new URL("/settings", request.url);
  settings.searchParams.set("meta_error", "use_contextual_connect");
  return NextResponse.redirect(settings);
}
