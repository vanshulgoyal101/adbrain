import { redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { ProductTelemetry } from "@/components/product-telemetry";
import { getPrimaryBusiness, getUser } from "@/lib/supabase/queries";

export const metadata = {
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();
  if (!user) redirect("/login");
  const business = await getPrimaryBusiness();
  return <WorkspaceShell email={user.email} businessName={business?.name ?? null}><ProductTelemetry />{children}</WorkspaceShell>;
}
