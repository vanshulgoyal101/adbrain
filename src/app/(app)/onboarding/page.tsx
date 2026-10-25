import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ManagedOnboardingLive } from "@/components/managed/managed-onboarding-live";
import { getEnv } from "@/lib/env";
import { getPrimaryBusiness } from "@/lib/supabase/queries";

export const metadata = { title: "Get ready to advertise" };
export const dynamic = "force-dynamic";

/** #526 (2-Tier): from sign-up to 'Ready to advertise'. Off unless MANAGED_ACCOUNTS_ENABLED. */
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ attemptId?: string }> }) {
  if (!getEnv().MANAGED_ACCOUNTS_ENABLED) notFound();
  const business = await getPrimaryBusiness();
  if (!business) redirect("/brand");
  const attemptId = z.uuid().safeParse((await searchParams).attemptId);
  return <ManagedOnboardingLive businessId={business.id} initialAttemptId={attemptId.success ? attemptId.data : null} />;
}
