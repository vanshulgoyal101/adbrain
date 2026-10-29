// Supabase advisors gate (#359): node scripts/advisors.mjs
// Reads the production security and performance advisors (Management API, read-only) and
// exits 1 on any WARN or ERROR not listed in ACCEPTED below. Run it before and after a release.
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

const projectId = "kmzuxrvfrwwpwmoovwcp";

/** Reviewed findings that stay, each with its reason. Key: `<lint>:<schema>.<object>`. */
export const ACCEPTED = {
  // Owner-only RPCs: they check auth.uid() ownership inside and must bypass the RPC-only write rules.
  "authenticated_security_definer_function_executable:public.change_declared_preferences": "checks business ownership inside",
  "authenticated_security_definer_function_executable:public.update_campaign_draft_if_version": "checks owner and business inside",
  "authenticated_security_definer_function_executable:public.delete_campaign_draft_if_version": "checks owner and business inside",
  "authenticated_security_definer_function_executable:public.owner_alert_prefs_set": "checks auth.uid() and business ownership inside; preserves WhatsApp STOP (#974)",
  "authenticated_security_definer_function_executable:public.owner_alert_start_verification": "checks auth.uid() and business ownership inside; issues an expiring verification code (#974)",
  "authenticated_security_definer_function_executable:public.business_transfer_mine": "returns only the signed-in, email-confirmed user's own pending transfer (#1783)",
  "authenticated_security_definer_function_executable:public.business_transfer_decline": "only the signed-in, email-confirmed target can decline their own transfer (#1783)",
  "authenticated_security_definer_function_executable:public.business_transfer_claim": "requires auth.uid(); private.business_transfer_complete re-checks target, owner and locks (#1783)",
  // HaveIBeenPwned checks need the Supabase Pro plan (402 on the Free plan); a CEO money decision (#359).
  "auth_leaked_password_protection:.": "needs the Supabase Pro plan",
};

export const lintKey = (lint) => `${lint.name}:${lint.metadata?.schema ?? ""}.${lint.metadata?.name ?? ""}`;

export function newFindings(lints) {
  return lints.filter((lint) => lint.level !== "INFO" && !(lintKey(lint) in ACCEPTED));
}

async function main() {
  const token = parseEnv(await readFile(join(homedir(), "Development/copilot/arcade/.env"), "utf8")).SUPABASE_TOKEN;
  if (!token) throw new Error("Supabase Management token is unavailable.");
  const lints = [];
  for (const kind of ["security", "performance"]) {
    const response = await fetch(`https://api.supabase.com/v1/projects/${projectId}/advisors/${kind}`, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(`Advisors (${kind}) failed: HTTP ${response.status}.`);
    lints.push(...((await response.json()).lints ?? []));
  }
  const counts = {};
  for (const lint of lints) counts[lint.level] = (counts[lint.level] ?? 0) + 1;
  const found = newFindings(lints);
  console.log(`Advisors: ${Object.entries(counts).map(([level, n]) => `${n} ${level}`).join(", ") || "none"}; ${Object.keys(ACCEPTED).length} accepted.`);
  for (const lint of found) console.log(`NEW ${lint.level} ${lintKey(lint)}: ${lint.title}`);
  if (found.length) process.exitCode = 1;
  else console.log("PASS no new WARN or ERROR.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Advisors check failed.");
    process.exitCode = 1;
  });
}
