import { LockKeyhole, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

export function CampaignLaunchReview({
  selectedCount,
  budget,
  leadFormName,
  audience,
}: {
  selectedCount: number;
  budget: number;
  leadFormName?: string;
  audience: string;
}) {
  const isReady =
    selectedCount > 0 &&
    budget > 0 &&
    !!leadFormName &&
    audience.trim().length > 0 &&
    audience !== "Choose an area";

  return (
    <section aria-labelledby="launch-review-title" className="flex flex-col gap-4 rounded-xl bg-slate-50 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex h-9 w-9 flex-none items-center justify-center rounded-lg",
            isReady ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700",
          )}
        >
          <LockKeyhole className="h-4 w-4" />
        </span>
        <div>
          <p id="launch-review-title" className="font-semibold text-slate-950">
            {isReady ? "Ready to launch" : "Review before launch"}
          </p>
          <p className="mt-0.5 text-sm text-slate-600">
            {isReady
              ? "Launch checklist is complete. AdBrain creates this campaign paused and nothing spends until you activate it."
              : "AdBrain creates this campaign paused. Nothing spends until you activate it."}
          </p>
        </div>
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs text-slate-500">Creative</dt>
          <dd className={cn("mt-1 font-medium", selectedCount ? "text-slate-900" : "text-amber-700")}>
            {selectedCount ? `${selectedCount} selected` : "Select an ad"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Budget</dt>
          <dd className={cn("mt-1 font-medium", budget > 0 ? "text-slate-900" : "text-amber-700")}>
            {budget > 0 ? `₹${budget}/day` : "Enter a budget"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500">Lead destination</dt>
          <dd className={cn("mt-1 truncate font-medium", leadFormName ? "text-slate-900" : "text-amber-700")}>
            {leadFormName ?? "Choose a lead form"}
          </dd>
        </div>
        <div>
          <dt className="flex items-center gap-1 text-xs text-slate-500">
            <MapPin className="h-3 w-3" /> Audience
          </dt>
          <dd className="mt-1 truncate font-medium text-slate-900" title={audience}>
            {audience}
          </dd>
        </div>
      </dl>
    </section>
  );
}
