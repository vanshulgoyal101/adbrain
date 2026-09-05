import Link from "next/link";
import { ArrowRight, Building2, CheckCircle2, MapPin, Sparkles } from "lucide-react";
import { AdAssistant } from "@/components/ad-assistant";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
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
      <PageHeader
        eyebrow="Create"
        title="Ad Assistant"
        description="Start with the outcome you want. AdBrain will ask only the questions needed to make a launch-ready ad."
      />
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
        <AdAssistant business={business} />
        <aside className="space-y-4 lg:sticky lg:top-6">
          <Card className="border-slate-200 bg-slate-950 text-white shadow-[0_14px_30px_rgba(15,23,42,0.12)]">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 text-amber-300">
                <Sparkles className="h-4 w-4" />
                <p className="text-xs font-semibold uppercase tracking-[0.14em]">What happens next</p>
              </div>
              <ol className="mt-5 space-y-4">
                {[
                  ["01", "Shape the brief", "A few focused questions fill the gaps."],
                  ["02", "Review the variants", "Compare the strongest directions."],
                  ["03", "Prepare the launch", "Approve before anything goes live."],
                ].map(([number, title, detail]) => (
                  <li key={number} className="flex gap-3">
                    <span className="text-xs font-semibold text-slate-400">{number}</span>
                    <div>
                      <p className="text-sm font-semibold">{title}</p>
                      <p className="mt-0.5 text-xs leading-5 text-slate-300">{detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
          <Card className="border-slate-200 bg-white/80">
            <CardContent className="p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Using your Brand Brain</p>
              <p className="mt-2 font-semibold text-slate-900">{business.name}</p>
              <div className="mt-3 space-y-2 text-sm text-slate-600">
                <p className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 flex-none text-emerald-600" />{business.brand_voice || "Your saved brand voice"}</p>
                <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 flex-none text-slate-500" />{business.locations.length ? business.locations.slice(0, 2).join(", ") : "Your saved service areas"}</p>
              </div>
              <Link href="/brand" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:text-blue-800">
                Tune Brand Brain <ArrowRight className="h-4 w-4" />
              </Link>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
