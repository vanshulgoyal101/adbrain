import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/env";
import {
  connectIntentSchema,
  type ConnectIntent,
} from "@/lib/meta/connect-contracts";
import {
  createBrowserBinding,
  createConnectionAttempt,
} from "@/lib/meta/connection-repository";
import {
  ConnectionAccessError,
  getConnectionStatus,
  requireOwnedBusiness,
} from "@/lib/meta/connection-access";
import {
  buildLoginUrl,
  metaOAuthConfigured,
  oauthRedirectUri,
  signState,
  verifyState,
} from "@/lib/meta/oauth";
import { createClient } from "@/lib/supabase/server";
import { canUseMetaConnect } from "@/lib/meta/pilot-access";

export const runtime = "nodejs";

function requestOriginAllowed(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return origin === new URL(getEnv().NEXT_PUBLIC_SITE_URL).origin;
  } catch {
    return false;
  }
}

function safeRequestId(): string {
  return crypto.randomUUID();
}

function errorResponse(
  requestId: string,
  status: number,
  code: string,
  message: string,
  retryable = false,
): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code, message, retryable }, requestId },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  const requestId = safeRequestId();
  if (!requestOriginAllowed(request)) {
    return errorResponse(requestId, 403, "FORBIDDEN", "Request origin is not allowed.");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return errorResponse(requestId, 401, "UNAUTHENTICATED", "Sign in required.");
  if (!canUseMetaConnect(user.id)) return errorResponse(requestId, 403, "FORBIDDEN", "Meta connection is not enabled for this account.");

  const body = await request.json().catch(() => null) as {
    businessId?: unknown;
    intent?: unknown;
  } | null;
  const businessId = typeof body?.businessId === "string" ? body.businessId.trim() : "";
  const parsedIntent = connectIntentSchema.safeParse(body?.intent);
  if (!businessId || !parsedIntent.success) {
    return errorResponse(requestId, 400, "INVALID_INPUT", "A valid business and connection intent are required.");
  }

  let business;
  try {
    business = await requireOwnedBusiness(businessId);
  } catch (error) {
    if (error instanceof ConnectionAccessError) {
      const status = error.code === "UNAUTHENTICATED" ? 401 : error.code === "NOT_FOUND" ? 404 : 403;
      return errorResponse(requestId, status, error.code, error.message);
    }
    return errorResponse(requestId, 503, "UNAVAILABLE", "Business access could not be checked.", true);
  }

  if (!metaOAuthConfigured()) {
    return errorResponse(requestId, 503, "SETUP_REQUIRED", "Meta connection is not available yet.");
  }

  const browserBinding = createBrowserBinding();
  const state = signState({ businessId: business.businessId, userId: business.userId, flow: "instant" });
  const signedState = verifyState(state);
  if (!signedState) {
    return errorResponse(requestId, 503, "UNAVAILABLE", "Meta connection could not be started.", true);
  }
  let attempt;
  try {
    const connection = await getConnectionStatus(business);
    attempt = await createConnectionAttempt({
      businessId: business.businessId,
      userId: business.userId,
      intent: parsedIntent.data as ConnectIntent,
      state,
      browserBinding,
      expectedGeneration: connection.generation,
    });
  } catch {
    return errorResponse(requestId, 503, "UNAVAILABLE", "Meta connection could not be started.", true);
  }

  const authorizationUrl = buildLoginUrl({
    appId: getEnv().META_APP_ID,
    redirectUri: oauthRedirectUri(),
    state,
    configId: getEnv().META_LOGIN_CONFIG_ID || undefined,
  });
  const response = NextResponse.json(
    {
      ok: true,
      data: { attemptId: attempt.attemptId, authorizationUrl, expiresAt: attempt.expiresAt },
      requestId,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
  response.cookies.set(`adbrain_meta_binding_${signedState.nonce}`, browserBinding, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: Math.ceil((attempt.expiresAt ? new Date(attempt.expiresAt).getTime() - Date.now() : 600_000) / 1000),
  });
  return response;
}