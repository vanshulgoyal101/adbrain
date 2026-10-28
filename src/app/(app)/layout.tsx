import { Suspense } from "react";
import { redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { ProductTelemetry } from "@/components/product-telemetry";
import { getPrimaryBusiness, getUser, hasLaunchedCampaign } from "@/lib/supabase/queries";
import Loading from "./loading";
import { getEnv } from "@/lib/env";
import { supportWhatsAppUrl } from "@/lib/support";

export const metadata = {
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Suspense fallback={<Loading />}><AuthenticatedWorkspace>{children}</AuthenticatedWorkspace></Suspense>;
}

async function AuthenticatedWorkspace({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect("/login");
  const business = await getPrimaryBusiness();
  const supportUrl = supportWhatsAppUrl(getEnv().SUPPORT_WHATSAPP, business?.name ?? null);
  // #1272: until a first campaign has gone live, + continues the setup instead of starting over; unknown counts as not.
  const firstAd = business ? !(await hasLaunchedCampaign(business.id).catch(() => true)) : true;
  return <WorkspaceShell email={user.email} ownerId={user.id} businessId={business?.id ?? null} businessName={business?.name ?? null} supportUrl={supportUrl} firstAd={firstAd}><ProductTelemetry />{children}</WorkspaceShell>;
}
