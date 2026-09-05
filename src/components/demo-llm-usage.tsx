import { Coins } from "lucide-react";
import type { LLMUsageSummary } from "@/lib/llm/persist";

export function DemoLlmUsage({ usage }: { usage: LLMUsageSummary }) {
  return (
    <aside
      aria-label="Demo AI usage"
      className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500"
    >
      <span className="flex items-center gap-2 font-medium text-slate-700">
        <Coins className="h-3.5 w-3.5 text-amber-600" />
        Ad generation spend
      </span>
      <span>
        <strong className="font-semibold text-slate-950">
          ${usage.estimatedCostUsd.toFixed(4)}
        </strong>{" "}
        estimated
      </span>
      <span>{usage.calls} calls</span>
      <span>{usage.totalTokens.toLocaleString()} tokens</span>
      {usage.provider && (
        <span className="ml-auto text-slate-400">
          {usage.provider} / {usage.model}
        </span>
      )}
    </aside>
  );
}