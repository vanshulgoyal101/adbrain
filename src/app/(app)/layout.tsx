import { Suspense } from "react";
import { preconnect } from "react-dom";
import { redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { ProductTelemetry } from "@/components/product-telemetry";
import { getPrimaryBusiness, getUser, hasLaunchedCampaign } from "@/lib/supabase/queries";
import Loading from "./loading";
import { getEnv } from "@/lib/env";
import { supportWhatsAppUrl } from "@/lib/support";
import { namespaceMessages } from "@/i18n/locale";
import { requestLocale } from "@/i18n/request-locale";

export const metadata = {
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // #1393: ad pictures come from Supabase Storage; open that connection while the workspace is still loading,
  // not after the page streams in (3 round trips on a slow phone network).
  const storage = getEnv().NEXT_PUBLIC_SUPABASE_URL;
  if (storage) preconnect(new URL(storage).origin);
  return <Suspense fallback={<Loading />}><AuthenticatedWorkspace>{children}</AuthenticatedWorkspace></Suspense>;
}

async function AuthenticatedWorkspace({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect("/login");
  const business = await getPrimaryBusiness();
  const supportUrl = supportWhatsAppUrl(getEnv().SUPPORT_WHATSAPP, business?.name ?? null);
  // #1272: until a first campaign has gone live, + continues the setup instead of starting over; unknown counts as not.
  const firstAd = business ? !(await hasLaunchedCampaign(business.id).catch(() => true)) : true;
  const locale = await requestLocale();
  const labels = namespaceMessages(locale, "shell");
  return <WorkspaceShell labels={labels} locale={locale} email={user.email} ownerId={user.id} businessId={business?.id ?? null} businessName={business?.name ?? null} supportUrl={supportUrl} firstAd={firstAd}><ProductTelemetry />{children}</WorkspaceShell>;
}
