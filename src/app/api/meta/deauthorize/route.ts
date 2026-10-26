import { createHmac } from "node:crypto";
import { observeRoute } from "@/lib/observability/logger";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyMetaSignedRequest } from "@/lib/meta/oauth";

export const runtime = "nodejs";

export const POST = observeRoute("/api/meta/deauthorize", "POST", handlePOST);

async function handlePOST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  const form = contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")
    ? await request.formData().catch(() => null)
    : null;
  const json = !form
    ? await request.json().catch(() => null) as { signed_request?: unknown } | null
    : null;
  const formValue = form?.get("signed_request");
  const value = typeof formValue === "string"
    ? formValue
    : typeof json?.signed_request === "string" ? json.signed_request : "";
  const signed = value ? verifyMetaSignedRequest(value) : null;
  if (!signed) return NextResponse.json({ error: "Invalid deauthorization request." }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin.rpc("meta_revoke_subject", {
    p_subject_id: signed.userId,
  });
  if (error) return NextResponse.json({ error: "Deauthorization could not be recorded." }, { status: 503 });
  // Meta's data deletion callback contract: a status URL plus an alphanumeric
  // confirmation code. The code is a stable keyed digest, so retries match.
  const env = getEnv();
  const confirmationCode = createHmac("sha256", env.META_APP_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || "")
    .update(`meta-deletion:${signed.userId}`)
    .digest("hex")
    .slice(0, 16);
  // #730: the operator queue gets the request the status URL promises to answer; a failure makes Meta retry.
  const recorded = await admin.rpc("meta_deletion_request_record", { p_subject_id: signed.userId, p_code: confirmationCode });
  if (recorded.error) return NextResponse.json({ error: "Deletion request could not be recorded." }, { status: 503 });
  return NextResponse.json({
    url: `${env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")}/data-deletion?code=${confirmationCode}`,
    confirmation_code: confirmationCode,
  });
}