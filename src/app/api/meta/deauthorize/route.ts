import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyMetaSignedRequest } from "@/lib/meta/oauth";

export const runtime = "nodejs";

export async function POST(request: Request) {
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

  const { error } = await createAdminClient().rpc("meta_revoke_subject", {
    p_subject_id: signed.userId,
  });
  if (error) return NextResponse.json({ error: "Deauthorization could not be recorded." }, { status: 503 });
  return NextResponse.json({
    url: `${getEnv().NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")}/data-deletion`,
  });
}