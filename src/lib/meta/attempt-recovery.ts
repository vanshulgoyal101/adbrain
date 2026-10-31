import { z } from "zod";
import type { AttemptDTO, Blocker, CandidateDTO } from "./connect-contracts";

const snapshotSchema = z.object({
  adAccounts: z.array(z.object({ id: z.string() })),
  pages: z.array(z.object({ tasks: z.array(z.string()).optional() })),
});

const settings = {
  kind: "open_meta" as const,
  url: "https://business.facebook.com/settings/",
  label: "Open business settings",
};

export function buildAttemptBlockers(input: {
  state: AttemptDTO["state"];
  errorCode: string | null;
  discoveryComplete: boolean;
  snapshot: unknown;
  candidates: readonly CandidateDTO[];
}): Blocker[] {
  if (["connected", "selection_required", "authorizing", "discovering"].includes(input.state)) return [];
  if (["expired", "cancelled"].includes(input.state) || input.errorCode === "REAUTH_REQUIRED") {
    return [{ code: "REAUTH_REQUIRED", message: "This authorization is no longer usable. Reconnect Meta to continue with your saved work.", action: { kind: "reconnect" } }];
  }
  if (input.errorCode === "MISSING_PERMISSION") {
    return [{ code: "MISSING_PERMISSION", message: "Meta did not grant the requested access. Reconnect Meta and allow everything it asks for, including your Page and ad account.", action: { kind: "reconnect" } }];
  }
  if (input.errorCode === "DISCOVERY_INCOMPLETE" || (input.state === "action_required" && !input.discoveryComplete)) {
    return [{ code: "DISCOVERY_INCOMPLETE", message: "Meta has not returned the full asset list. Check again before choosing an account or changing your business setup.", action: { kind: "retry_check" } }];
  }
  if (input.state !== "action_required" || input.errorCode !== "SETUP_REQUIRED") {
    return [{ code: "UNAVAILABLE", message: "The connection could not finish. Check again, or reconnect Meta if the problem continues.", action: { kind: "retry_check" } }];
  }

  // #679: a first pilot is usually a one-person shop, its own admin, so each line names a fix it can do itself.
  // Business Login shares only the assets ticked in Meta's window, so an empty list is usually an unticked asset.
  const snapshot = snapshotSchema.safeParse(input.snapshot);
  const blockers: Blocker[] = [];
  if (snapshot.success) {
    if (snapshot.data.adAccounts.length === 0) {
      blockers.push({ code: "SETUP_REQUIRED", message: "Meta shared no ad account with AdBrain. Reconnect Meta and tick your ad account, or sign in with the profile that runs your ads. No ad account yet? Create one in rupees in your business portfolio.", action: settings });
    }
    if (snapshot.data.pages.length === 0) {
      blockers.push({ code: "SETUP_REQUIRED", message: "Meta shared no Facebook Page with AdBrain. Reconnect Meta and tick your Page, or sign in with the profile that manages your Page.", action: settings });
    } else if (!snapshot.data.pages.some(page => page.tasks?.some(task => ["ADVERTISE", "MANAGE"].includes(task)))) {
      blockers.push({ code: "MISSING_PERMISSION", message: "Your Facebook profile needs advertising or management access to a Page. In Meta Business Settings, give it full control of the Page (or ask the Page's admin to), then check again.", action: settings });
    }
  }
  for (const candidate of input.candidates) {
    for (const blocker of candidate.blockers) {
      if (blockers.some(existing => existing.code === blocker.code && existing.message === blocker.message)) continue;
      blockers.push({ ...blocker, action: blocker.action ?? settings });
    }
  }
  return blockers.length ? blockers.slice(0, 20) : [{
    code: "SETUP_REQUIRED",
    message: "Meta did not return a currency or time zone for your ad account. Check the ad account's settings in Meta Business Settings, then connect again.",
    action: settings,
  }];
}