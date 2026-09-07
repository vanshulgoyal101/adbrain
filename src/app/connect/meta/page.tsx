import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPrimaryBusiness } from "@/lib/supabase/queries";
import { canUseMetaConnect } from "@/lib/meta/pilot-access";
import { getConnectionStatus, requireOwnedBusiness } from "@/lib/meta/connection-access";
import { MetaConnectPilot } from "@/components/meta-connect/meta-connect-pilot";

export const dynamic = "force-dynamic";
export const metadata = { title: "Meta Connection" };

export default async function MetaConnectPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!canUseMetaConnect(user.id)) notFound();
  const business = await getPrimaryBusiness();
  if (!business) redirect("/brand");
  const context = await requireOwnedBusiness(business.id);
  const connection = await getConnectionStatus(context);
  return <MetaConnectPilot businessName={business.name} connection={connection} />;
}