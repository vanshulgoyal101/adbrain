import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { PrivacyOperatorQueue } from "@/components/privacy-requests";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Privacy requests" };

export default async function PrivacyOperatorPage() {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) notFound();
  const { data: allowed, error } = await createAdminClient().rpc("privacy_request_operator_allowed", { p_user_id: user.id });
  if (error) throw new Error("Privacy operator access is unavailable.");
  if (!allowed) notFound();

  return <div className="max-w-4xl space-y-6">
    <Link href="/settings" className="text-sm font-medium text-blue-700 underline underline-offset-4">Settings</Link>
    <PageHeader eyebrow="Operator" title="Privacy requests" description="Open requests, oldest first." />
    <PrivacyOperatorQueue />
  </div>;
}