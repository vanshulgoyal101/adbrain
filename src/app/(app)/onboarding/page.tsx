import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ManagedOnboardingLive } from "@/components/managed/managed-onboarding-live";
import { managedAccountsEnabledFor } from "@/lib/meta/managed-account";
import { createClient } from "@/lib/supabase/server";
import { getPrimaryBusiness } from "@/lib/supabase/queries";

export const metadata = { title: "Get ready to advertise" };
export const dynamic = "force-dynamic";

/** #526 (2-Tier): from sign-up to 'Ready to advertise'. Off unless MANAGED_ACCOUNTS_ENABLED, or for internal accounts (#523). */
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ attemptId?: string }> }) {
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!managedAccountsEnabledFor(user)) notFound();
  const business = await getPrimaryBusiness();
  if (!business) redirect("/brand");
  const attemptId = z.uuid().safeParse((await searchParams).attemptId);
  return <ManagedOnboardingLive businessId={business.id} initialAttemptId={attemptId.success ? attemptId.data : null} />;
}
