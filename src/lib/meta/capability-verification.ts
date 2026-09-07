import { z } from "zod";
import type { Capabilities, Capability, SelectedAssets } from "./connect-contracts";

const accountSchema = z.object({
  id: z.string(), account_status: z.number().optional(), currency: z.string().optional(),
  timezone_name: z.string().optional(), user_tasks: z.array(z.string()).optional(),
  funding_source_details: z.object({ id: z.string().optional() }).nullish(),
});
const pagesSchema = z.object({ data: z.array(z.object({ id: z.string(), tasks: z.array(z.string()).optional() })) });
const permissionsSchema = z.object({ data: z.array(z.object({ permission: z.string(), status: z.string() })) });

function unavailable(message: string, state: "blocked" | "unknown" = "blocked"): Capability {
  return { state, blockers: [{ code: "MISSING_PERMISSION", message, action: { kind: "retry_check" } }] };
}

export async function verifyMetaCapabilities(token: string, selected: SelectedAssets): Promise<Capabilities> {
  async function read(path: string): Promise<unknown> {
    const response = await fetch(`https://graph.facebook.com/v21.0/${path}`, {
      method: "GET", headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Meta access could not be verified.");
    return response.json();
  }
  const available: Capability = { state: "available", blockers: [] };
  const unknown = unavailable("Meta access could not be verified. Check again.", "unknown");
  const result: Capabilities = { canReadInsights: unknown, canReadLeads: unknown, canCreatePaused: unknown, canActivate: unknown };
  const [accountResult, pagesResult, permissionsResult, insightsResult, formsResult] = await Promise.allSettled([
    read(`${encodeURIComponent(selected.adAccountId)}?fields=id,account_status,currency,timezone_name,user_tasks,funding_source_details`).then(value => accountSchema.parse(value)),
    read("me/accounts?fields=id,tasks&limit=200").then(value => pagesSchema.parse(value)),
    read("me/permissions?limit=200").then(value => permissionsSchema.parse(value)),
    read(`${encodeURIComponent(selected.adAccountId)}/insights?fields=impressions&limit=1`),
    read(`${encodeURIComponent(selected.pageId)}/leadgen_forms?fields=id,status&limit=1`),
  ]);
  if (permissionsResult.status !== "fulfilled") return result;
  const scopes = new Set(permissionsResult.value.data.filter(entry => entry.status === "granted").map(entry => entry.permission));
  if (insightsResult.status === "fulfilled" && (scopes.has("ads_read") || scopes.has("ads_management"))) result.canReadInsights = available;
  if (formsResult.status === "fulfilled" && scopes.has("leads_retrieval") && scopes.has("pages_read_engagement")) result.canReadLeads = available;
  if (accountResult.status !== "fulfilled" || pagesResult.status !== "fulfilled") return result;
  const account = accountResult.value;
  const page = pagesResult.value.data.find(candidate => candidate.id === selected.pageId);
  const canAdvertise = account.user_tasks?.some(task => ["ADVERTISE", "MANAGE"].includes(task))
    && page?.tasks?.some(task => ["ADVERTISE", "MANAGE"].includes(task));
  if (account.id !== selected.adAccountId || account.account_status !== 1 || account.currency !== "INR"
    || account.currency !== selected.currency || !account.timezone_name || account.timezone_name !== selected.timezoneName) {
    result.canCreatePaused = result.canActivate = unavailable("Verify the selected account status, currency, and timezone in Meta.");
  } else if (!canAdvertise || !scopes.has("ads_management") || !scopes.has("pages_manage_ads")) {
    result.canCreatePaused = result.canActivate = unavailable("Meta advertising permission is required for this account and Page.");
  } else {
    result.canCreatePaused = available;
    result.canActivate = account.funding_source_details?.id ? available : {
      state: "blocked", blockers: [{ code: "BILLING_REQUIRED", message: "Meta billing must be verified before activation.", action: null }],
    };
  }
  return result;
}