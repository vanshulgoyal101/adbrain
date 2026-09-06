import { redirect } from "next/navigation";
import { WorkspaceShell } from "@/components/workspace-shell";
import { getPrimaryBusiness, getUser } from "@/lib/supabase/queries";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();
  if (!user) redirect("/login");
  const business = await getPrimaryBusiness();
  return <WorkspaceShell email={user.email} businessName={business?.name ?? null}>{children}</WorkspaceShell>;
}
