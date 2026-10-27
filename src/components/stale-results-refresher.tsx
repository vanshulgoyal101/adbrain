"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { refreshIfStale } from "@/lib/campaign/results-freshness";

/** #1003: Home refreshes stale live results quietly, one campaign at a time, then re-renders once with the new numbers. */
export function StaleResultsRefresher({ campaignIds }: { campaignIds: string[] }) {
  const router = useRouter();
  const tried = useRef(new Set<string>());
  const key = campaignIds.join(",");
  useEffect(() => {
    const ids = key.split(",").filter((id) => id && !tried.current.has(id));
    if (!ids.length) return;
    for (const id of ids) tried.current.add(id);
    void (async () => {
      let changed = false;
      for (const id of ids) {
        const data = await refreshIfStale(id);
        if (data && !data.fresh) changed = true;
      }
      if (changed) router.refresh();
    })();
  }, [key, router]);
  return null;
}
