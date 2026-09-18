import { setTimeout as delay } from "node:timers/promises";
import { createAdminClient } from "../src/lib/supabase/admin";
import { runNextCampaignJob } from "../src/lib/campaign/worker";

async function main() {
  const target = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (process.env.CAMPAIGN_EXECUTION_MODE !== "worker" || !target || process.env.CAMPAIGN_WORKER_TARGET !== new URL(target).origin) {
    throw new Error("Worker mode and an exact CAMPAIGN_WORKER_TARGET origin are required.");
  }
  const shutdown = new AbortController();
  process.once("SIGTERM", () => shutdown.abort());
  process.once("SIGINT", () => shutdown.abort());
  const database = createAdminClient();
  const once = process.argv.includes("--once");
  do {
    try {
      const worked = await runNextCampaignJob(database, shutdown.signal);
      if (once) return;
      if (!worked) await delay(1000, undefined, { signal: shutdown.signal });
    } catch {
      if (shutdown.signal.aborted) return;
      console.error(JSON.stringify({ event: "campaign.worker.failed", message: "Queue or execution failed. Inspect operation status; no mutation retry was attempted." }));
      if (once) { process.exitCode = 1; return; }
      await delay(5000, undefined, { signal: shutdown.signal }).catch(() => {});
    }
  } while (!shutdown.signal.aborted);
}

main().catch(() => {
  console.error("Worker startup failed. Check explicit target, mode, and server credentials.");
  process.exitCode = 1;
});