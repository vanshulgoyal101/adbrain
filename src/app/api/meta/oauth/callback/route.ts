import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireOwnedBusiness } from "@/lib/meta/connection-access";
import {
  claimConnectionAttempt,
  attachAttemptToken,
  markAttemptCancelled,
  markAttemptDiscovering,
  markAttemptDiscoveryResult,
  markAttemptFailed,
  commitSelectedConnection,
  getConnectionAttempt,
  saveEncryptedMetaToken,
} from "@/lib/meta/connection-repository";
import {
  buildCandidateDTOs,
  buildDiscoveryPairs,
  decideSelection,
} from "@/lib/meta/selection";
import { verifyState } from "@/lib/meta/oauth";
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  inspectMetaToken,
  oauthRedirectUri,
  discoverMetaAssets,
} from "@/lib/meta/oauth";

export const runtime = "nodejs";

/** Meta redirects here with `?code&state` after the owner authorises. */
export async function GET(request: NextRequest) {
  const settings = new URL("/connect/meta/complete", request.url);
  const params = request.nextUrl.searchParams;

  const oauthError = params.get("error");
  const code = params.get("code");
  const state = params.get("state") ?? "";
  const verified = verifyState(state);
  if (!verified) {
    settings.searchParams.set("error", "invalid_state");
    return NextResponse.redirect(settings);
  }

  // The person completing the flow must be the one who started it.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== verified.userId) {
    settings.searchParams.set("error", "invalid_state");
    return NextResponse.redirect(settings);
  }

  try {
    await requireOwnedBusiness(verified.businessId);
  } catch {
    settings.searchParams.set("error", "business_access_denied");
    return NextResponse.redirect(settings);
  }

  const browserBinding = request.cookies.get(`adbrain_meta_binding_${verified.nonce}`)?.value;
  const claimed = browserBinding
    ? await claimConnectionAttempt({
    state,
    browserBinding,
    userId: user.id,
    })
    : null;
  if (!claimed) {
    settings.searchParams.set("error", "invalid_attempt");
    return NextResponse.redirect(settings);
  }

  if (oauthError) {
    await markAttemptCancelled(claimed.attemptId).catch(() => undefined);
    settings.searchParams.set("error", "oauth_cancelled");
    return NextResponse.redirect(settings);
  }
  if (!code) {
    settings.searchParams.set("error", "missing_code");
    return NextResponse.redirect(settings);
  }

  try {
    const shortToken = await exchangeCodeForToken(code, oauthRedirectUri());
    const { accessToken, expiresInSec } = await exchangeForLongLivedToken(shortToken);
    const inspection = await inspectMetaToken(accessToken);
    const expiries = [inspection.expiresAt ? new Date(inspection.expiresAt).getTime() : null,
      expiresInSec === null ? null : Date.now() + expiresInSec * 1000].filter((expiry): expiry is number => expiry !== null);
    const expiresAt = expiries.length ? new Date(Math.min(...expiries)).toISOString() : null;
    const tokenId = await saveEncryptedMetaToken({
      businessId: verified.businessId,
      userId: user.id,
      subjectId: inspection.metaUserId,
      token: accessToken,
      expiresAt,
      dataAccessExpiresAt: inspection.dataAccessExpiresAt,
      scopes: inspection.grantedScopes,
      grantedAssets: [],
    });
    await markAttemptDiscovering(claimed.attemptId);
    await attachAttemptToken(claimed.attemptId, tokenId);
    const discovery = await discoverMetaAssets(accessToken);
    const pairs = buildDiscoveryPairs({
      adAccounts: discovery.adAccounts,
      pages: discovery.pages,
      relationshipPairs: discovery.relationshipPairs,
      supportedCurrencies: ["INR"],
    });
    const candidates = buildCandidateDTOs(pairs);
    const decision = decideSelection({ complete: discovery.complete, pairs });
    const snapshot = JSON.parse(JSON.stringify({
      kind: "asset_snapshot",
      complete: discovery.complete,
      adAccounts: discovery.adAccounts,
      pages: discovery.pages,
      relationshipPairs: discovery.relationshipPairs,
      candidates,
    }));
    const resultStatus = decision.kind === "choose" || decision.kind === "auto_link"
      ? "selection_required"
      : "action_required";
    await markAttemptDiscoveryResult(
      claimed.attemptId,
      snapshot,
      resultStatus,
      !discovery.complete ? "DISCOVERY_INCOMPLETE" : resultStatus === "action_required" ? "SETUP_REQUIRED" : null,
    );
    if (decision.kind === "auto_link") {
      const attempt = await getConnectionAttempt(claimed.attemptId, user.id);
      if (attempt) {
        await commitSelectedConnection({
          attemptId: claimed.attemptId,
          userId: user.id,
          pairId: decision.pair.pairId,
          revision: attempt.revision,
          confirmReplacement: true,
        });
      }
    }
    settings.searchParams.set("attemptId", claimed.attemptId);
    return NextResponse.redirect(settings);
  } catch {
    await markAttemptFailed(claimed.attemptId, "REAUTH_REQUIRED").catch(() => undefined);
    settings.searchParams.set("error", "provider_rejected");
    return NextResponse.redirect(settings);
  }
}
