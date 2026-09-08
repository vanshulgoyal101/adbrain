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
    return [{ code: "MISSING_PERMISSION", message: "Meta did not grant the requested access. Reconnect and allow access to your business assets, or ask your business admin for help.", action: { kind: "reconnect" } }];
  }
  if (input.errorCode === "DISCOVERY_INCOMPLETE" || (input.state === "action_required" && !input.discoveryComplete)) {
    return [{ code: "DISCOVERY_INCOMPLETE", message: "Meta has not returned the full asset list. Check again before choosing an account or changing your business setup.", action: { kind: "retry_check" } }];
  }
  if (input.state !== "action_required" || input.errorCode !== "SETUP_REQUIRED") {
    return [{ code: "UNAVAILABLE", message: "The connection could not finish. Check again, or reconnect Meta if the problem continues.", action: { kind: "retry_check" } }];
  }

  const snapshot = snapshotSchema.safeParse(input.snapshot);
  const blockers: Blocker[] = [];
  if (snapshot.success) {
    if (snapshot.data.adAccounts.length === 0) {
      blockers.push({ code: "SETUP_REQUIRED", message: "No accessible ad account was returned. Ask your business admin for ad account access, or reconnect with the Facebook profile that has access.", action: settings });
    }
    if (snapshot.data.pages.length === 0) {
      blockers.push({ code: "SETUP_REQUIRED", message: "No accessible Facebook Page was returned. Ask your business admin for Page access and include that Page when reconnecting.", action: settings });
    } else if (!snapshot.data.pages.some(page => page.tasks?.some(task => ["ADVERTISE", "MANAGE"].includes(task)))) {
      blockers.push({ code: "MISSING_PERMISSION", message: "Your Facebook profile needs advertising or management access to a Page. Ask your business admin to grant that access, then check again.", action: settings });
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
    message: "No eligible account and Page pair could be verified. Ask your business admin to check asset access, account currency, timezone, and the Page's business assignment.",
    action: settings,
  }];
}