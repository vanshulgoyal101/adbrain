import { createHash } from "node:crypto";
import { getConnectionStatus, withMetaConnection, type AuthorizedBusiness } from "@/lib/meta/connection-access";
import { draftRecordFromRow } from "@/lib/campaign/draft-store";
import type { PreflightLoaders } from "@/lib/campaign/preflight-service";
import type { createClient } from "@/lib/supabase/server";

export type CampaignSupabase = Awaited<ReturnType<typeof createClient>>;

export function buildCampaignPreflightLoaders(
  supabase: CampaignSupabase,
  authorizedBusiness: AuthorizedBusiness,
): PreflightLoaders {
  return {
    findDraft: async (actor, draftId) => {
      const { data } = await supabase
        .from("campaign_drafts")
        .select("*")
        .eq("id", draftId)
        .eq("business_id", actor.businessId)
        .eq("owner_id", actor.userId)
        .maybeSingle();
      return data ? draftRecordFromRow(data) : null;
    },
    findCreatives: async (businessId, creativeIds) => {
      const { data } = await supabase
        .from("creatives")
        .select("id, business_id, status, image_url, headline")
        .in("id", creativeIds)
        .eq("business_id", businessId);
      return (data ?? []).map((creative) => ({
        id: creative.id,
        businessId: creative.business_id,
        approved: creative.status === "approved",
        imageUrl: creative.image_url,
        headline: creative.headline,
      }));
    },
    findForm: async (businessId, formId) => {
      const connection = await getConnectionStatus(authorizedBusiness);
      if (connection.capabilities.canCreatePaused.state !== "available") return null;
      const forms = await withMetaConnection(
        authorizedBusiness,
        { purpose: "create_paused" },
        (meta) => meta.listLeadForms(),
      );
      const form = forms.find((candidate) => candidate.id === formId);
      return form
        ? { id: form.id, businessId, active: form.status.toUpperCase() === "ACTIVE" }
        : null;
    },
    getConnection: async () => {
      const connection = await getConnectionStatus(authorizedBusiness);
      return {
        generation: connection.generation,
        selected: connection.selected,
        canCreatePaused: connection.capabilities.canCreatePaused.state === "available",
      };
    },
    resolveGeo: async (actor, draft) => {
      const location = draft.input.targeting.location;
      if (location?.mode === "manual" && location.included?.length) {
        return {
          resolvedAreaLabel: location.included.map((item) => item.name).join(", "),
          unresolvedNames: [],
          explicitlyNationwide: false,
        };
      }
      const { data: business } = await supabase
        .from("businesses")
        .select("locations")
        .eq("id", actor.businessId)
        .maybeSingle();
      const names = business?.locations ?? [];
      if (!names.length) return { resolvedAreaLabel: null, unresolvedNames: [], explicitlyNationwide: false };
      const connection = await getConnectionStatus(authorizedBusiness);
      if (connection.capabilities.canCreatePaused.state !== "available") {
        return { resolvedAreaLabel: null, unresolvedNames: names, explicitlyNationwide: false };
      }
      return withMetaConnection(
        authorizedBusiness,
        { purpose: "create_paused" },
        async (meta) => {
          const resolved = await meta.resolveGeoTargeting(names, {
            radiusKm: location?.radiusKm,
          });
          return {
            resolvedAreaLabel: resolved.matched.length
              ? resolved.matched.map((item) => item.label).join(", ")
              : null,
            unresolvedNames: resolved.unresolved.length
              ? resolved.unresolved
              : resolved.matched.length
                ? []
                : names,
            explicitlyNationwide: false,
          };
        },
      );
    },
    hash: (payload) => createHash("sha256").update(payload).digest("hex"),
  };
}