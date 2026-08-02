import { Megaphone, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/card";
import { isMetaConfigured } from "@/lib/meta/client";

export default function CampaignsPage() {
  const metaReady = isMetaConfigured();

  return (
    <div>
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-slate-900">Campaigns</h1>
        <Badge
          className={
            metaReady
              ? "bg-emerald-50 text-emerald-700"
              : "bg-amber-50 text-amber-700"
          }
        >
          {metaReady ? "Meta connected" : "Meta not connected"}
        </Badge>
      </div>
      <p className="mt-1 text-slate-600">
        Launching approved creatives into Meta Advantage+ is a Phase 1 feature.
      </p>

      <Card className="mt-6">
        <CardContent className="flex flex-col items-start gap-4 p-8">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <Megaphone className="h-6 w-6" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Live Meta launch — coming in Phase 1
            </h2>
            <p className="mt-1 max-w-lg text-sm text-slate-600">
              Once your Solaride system-user token is added to the environment,
              this page will create an Advantage+ Leads campaign from your
              approved creatives and report results in plain language.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            {metaReady
              ? "Credentials detected — wiring the launch flow is the next step."
              : "Add META_SYSTEM_USER_TOKEN, META_AD_ACCOUNT_ID, and META_PAGE_ID to enable."}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
