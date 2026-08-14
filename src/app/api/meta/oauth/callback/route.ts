import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/audit";
import { MetaError } from "@/lib/meta/client";
import {
  META_LOGIN_SCOPES,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  oauthRedirectUri,
  verifyState,
} from "@/lib/meta/oauth";

export const runtime = "nodejs";

/** Meta redirects here with `?code&state` after the owner authorises. */
export async function GET(request: NextRequest) {
  const settings = new URL("/settings", request.url);
  const params = request.nextUrl.searchParams;

  const oauthError = params.get("error");
  if (oauthError) {
    settings.searchParams.set("meta_error", oauthError);
    return NextResponse.redirect(settings);
  }

  const code = params.get("code");
  const state = params.get("state") ?? "";
  const verified = verifyState(state);
  if (!code || !verified) {
    settings.searchParams.set("meta_error", "invalid_state");
    return NextResponse.redirect(settings);
  }

  // The person completing the flow must be the one who started it.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== verified.userId) {
    settings.searchParams.set("meta_error", "invalid_state");
    return NextResponse.redirect(settings);
  }

  try {
    const shortToken = await exchangeCodeForToken(code, oauthRedirectUri());
    const { accessToken, expiresInSec } =
      await exchangeForLongLivedToken(shortToken);
    const expiresAt = new Date(Date.now() + expiresInSec * 1000).toISOString();

    // Preserve any previously chosen account/page across a re-authorisation.
    const { data: existing } = await supabase
      .from("meta_credentials")
      .select("ad_account_id, page_id")
      .eq("business_id", verified.businessId)
      .maybeSingle();

    const { error } = await supabase.from("meta_credentials").upsert(
      {
        business_id: verified.businessId,
        access_token: accessToken,
        token_type: "oauth",
        token_expires_at: expiresAt,
        scopes: META_LOGIN_SCOPES.join(","),
        ad_account_id: existing?.ad_account_id ?? null,
        page_id: existing?.page_id ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "business_id" },
    );
    if (error) throw new Error(error.message);

    await logEvent({
      businessId: verified.businessId,
      action: "meta.connected",
      entityType: "business",
      entityId: verified.businessId,
      reason: "Facebook Login authorised",
    });

    settings.searchParams.set(
      existing?.ad_account_id && existing?.page_id ? "meta_connected" : "meta_select",
      "1",
    );
    return NextResponse.redirect(settings);
  } catch (err) {
    const message = err instanceof MetaError ? err.message : "connect_failed";
    settings.searchParams.set("meta_error", message);
    return NextResponse.redirect(settings);
  }
}
