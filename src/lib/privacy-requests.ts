import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type PrivacyRequest = { id: string; owner_id?: string | null; kind: "export" | "delete";
  status: "received" | "in_review" | "completed" | "declined"; created_at: string; updated_at: string;
  source?: "owner" | "meta_callback"; confirmation_code?: string | null };

const PRIVACY_REQUEST_FIELDS = "id,kind,status,created_at,updated_at";

/** The signed-in owner's latest privacy requests, or null when unauthenticated or unavailable. */
export async function listOwnPrivacyRequests(): Promise<PrivacyRequest[] | null> {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return null;
  const { data, error } = await client.from("privacy_requests").select(PRIVACY_REQUEST_FIELDS).eq("owner_id", user.id)
    .order("created_at", { ascending: false }).limit(20);
  return error ? null : (data as PrivacyRequest[]);
}

/** Whether the signed-in user may work the privacy operator queue. */
export async function privacyOperatorAllowed(): Promise<boolean> {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return false;
  const { data, error } = await createAdminClient().rpc("privacy_request_operator_allowed", { p_user_id: user.id });
  return !error && data === true;
}

/** #730: the status of the Facebook deletion request behind a status-URL code, or null when none matches. */
export async function metaDeletionStatus(code: string): Promise<PrivacyRequest["status"] | null> {
  const { data, error } = await createAdminClient().from("privacy_requests").select("status,created_at")
    .eq("confirmation_code", code).order("created_at", { ascending: false }).limit(20);
  if (error) throw new Error("Deletion status unavailable.");
  const statuses = (data ?? []).map((row) => row.status as PrivacyRequest["status"]);
  if (!statuses.length) return null;
  if (statuses.includes("in_review")) return "in_review";
  if (statuses.includes("received")) return "received";
  return statuses[0];
}
