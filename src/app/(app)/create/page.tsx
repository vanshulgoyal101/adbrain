import Link from "next/link";
import { Building2 } from "lucide-react";
import { AdAssistant } from "@/components/ad-assistant";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getPrimaryBusiness } from "@/lib/supabase/queries";

export const metadata = {
  title: "Ad Assistant",
  description:
    "Make an ad in a few taps. Tell AdBrain what you want and answer a couple of easy questions.",
};

export default async function CreatePage() {
  const business = await getPrimaryBusiness();

  if (!business) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Ad Assistant</h1>
        <Card className="mt-6">
          <CardContent className="flex flex-col items-start gap-4 p-8">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
              <Building2 className="h-6 w-6" />
            </span>
            <p className="max-w-md text-slate-600">
              Set up your Brand Brain first — the assistant uses it to make
              on-brand ads for you.
            </p>
            <Link href="/brand">
              <Button>Go to Brand Brain</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Ad Assistant</h1>
      <p className="mt-1 text-slate-600">
        The easy way to make an ad — just tell me what you want.
      </p>
      <div className="mt-6 max-w-3xl">
        <AdAssistant business={business} />
      </div>
    </div>
  );
}
