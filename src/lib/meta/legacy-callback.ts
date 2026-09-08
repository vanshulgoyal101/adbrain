import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logEvent } from "@/lib/audit";
import {
  META_LOGIN_SCOPES,
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  oauthRedirectUri,
  type MetaOAuthState,
} from "./oauth";

export async function completeLegacyMetaOAuth(request: NextRequest, verified: MetaOAuthState) {
  const settings = new URL("/settings", request.url);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.id !== verified.userId) {
    settings.searchParams.set("meta_error", "invalid_state");
    return NextResponse.redirect(settings);
  }
  const code = request.nextUrl.searchParams.get("code");
  if (request.nextUrl.searchParams.has("error") || !code) {
    settings.searchParams.set("meta_error", code ? "access_denied" : "connect_failed");
    return NextResponse.redirect(settings);
  }
  try {
    const shortToken = await exchangeCodeForToken(code, oauthRedirectUri());
    const { accessToken, expiresInSec } = await exchangeForLongLivedToken(shortToken);
    const { data: existing } = await supabase.from("meta_credentials")
      .select("ad_account_id, page_id").eq("business_id", verified.businessId).maybeSingle();
    const { error } = await supabase.from("meta_credentials").upsert({
      business_id: verified.businessId,
      access_token: accessToken,
      token_type: "oauth",
      token_expires_at: expiresInSec === null ? null : new Date(Date.now() + expiresInSec * 1000).toISOString(),
      scopes: META_LOGIN_SCOPES.join(","),
      ad_account_id: existing?.ad_account_id ?? null,
      page_id: existing?.page_id ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "business_id" });
    if (error) throw new Error("connect_failed");
    await logEvent({
      businessId: verified.businessId,
      action: "meta.connected",
      entityType: "business",
      entityId: verified.businessId,
      reason: "Facebook Login authorised",
    });
    settings.searchParams.set(existing?.ad_account_id && existing?.page_id ? "meta_connected" : "meta_select", "1");
  } catch {
    settings.searchParams.set("meta_error", "connect_failed");
  }
  return NextResponse.redirect(settings);
}