import { formatMoney } from "@/lib/format";

/** The composer's test choices: the audience A/B by age, and (#2273, team accounts only) the no-Facebook-Reels test. */
export function CampaignTestOptions({ abTest, onAbTest, totalDailyBudget, noFacebookReels, onNoFacebookReels }: {
  abTest: boolean;
  onAbTest: (value: boolean) => void;
  totalDailyBudget: number;
  /** Absent for everyone outside internal-accounts.ts. */
  noFacebookReels?: boolean;
  onNoFacebookReels?: (value: boolean) => void;
}) {
  return (
    <>
      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-slate-200 p-3">
        <input type="checkbox" checked={abTest} onChange={(e) => onAbTest(e.target.checked)} className="mt-0.5 h-4 w-4 accent-blue-600" />
        <span className="text-sm">
          <span className="font-medium text-slate-800">A/B test the audience by age</span>
          <span className="block text-xs text-slate-500">
            Two ad sets, each with the entered daily budget. Total daily budget: {formatMoney(totalDailyBudget)}.
          </span>
        </span>
      </label>
      {noFacebookReels !== undefined && onNoFacebookReels && (
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-dashed border-slate-300 p-3">
          <input type="checkbox" checked={noFacebookReels} onChange={(e) => onNoFacebookReels(e.target.checked)} className="mt-0.5 h-4 w-4 accent-blue-600" />
          <span className="text-sm">
            <span className="font-medium text-slate-800">No Facebook Reels (team test)</span>
            <span className="block text-xs text-slate-500">
              Leaves Facebook Reels out; every other placement stays automatic. Only the AdBrain team sees this (#680).
            </span>
          </span>
        </label>
      )}
    </>
  );
}
