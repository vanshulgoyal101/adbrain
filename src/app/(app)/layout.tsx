import { Suspense } from "react";
import { redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { ProductTelemetry } from "@/components/product-telemetry";
import { getPrimaryBusiness, getUser } from "@/lib/supabase/queries";
import Loading from "./loading";

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
  return <WorkspaceShell email={user.email} businessName={business?.name ?? null}><ProductTelemetry />{children}</WorkspaceShell>;
}
