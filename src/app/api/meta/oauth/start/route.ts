import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getPrimaryBusiness } from "@/lib/supabase/queries";
import {
  buildLoginUrl,
  metaOAuthConfigured,
  oauthRedirectUri,
  signState,
} from "@/lib/meta/oauth";

export const runtime = "nodejs";

/** Begin the Facebook-Login connect flow: redirect the owner to Meta's dialog. */
export async function GET(request: NextRequest) {
  const settings = new URL("/settings", request.url);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (!metaOAuthConfigured()) {
    settings.searchParams.set("meta_error", "not_configured");
    return NextResponse.redirect(settings);
  }

  const business = await getPrimaryBusiness();
  if (!business) {
    settings.searchParams.set("meta_error", "no_business");
    return NextResponse.redirect(settings);
  }

  const state = signState({ businessId: business.id, userId: user.id });
  const url = buildLoginUrl({
    appId: getEnv().META_APP_ID,
    redirectUri: oauthRedirectUri(),
    state,
  });
  return NextResponse.redirect(url);
}
