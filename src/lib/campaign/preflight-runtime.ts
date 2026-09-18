import { createHash } from "node:crypto";
import { getConnectionStatus, withMetaConnection, type AuthorizedBusiness } from "@/lib/meta/connection-access";
import { draftRecordFromRow } from "@/lib/campaign/draft-store";
import type { PreflightLoaders } from "@/lib/campaign/preflight-service";
import type { createClient } from "@/lib/supabase/server";
import { resolveDraftTargeting } from "./draft-targeting";

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
        .select("id, business_id, status, image_url, headline, primary_text, cta")
        .in("id", creativeIds)
        .eq("business_id", businessId);
      return (data ?? []).map((creative) => ({
        id: creative.id,
        businessId: creative.business_id,
        approved: creative.status === "approved",
        imageUrl: creative.image_url,
        headline: creative.headline,
        primaryText: creative.primary_text,
        cta: creative.cta,
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
    findWhatsAppNumber: async () => {
      const connection = await getConnectionStatus(authorizedBusiness);
      if (connection.capabilities.canCreatePaused.state !== "available") return null;
      try {
        return await withMetaConnection(authorizedBusiness, { purpose: "create_paused" }, (meta) => meta.getWhatsAppNumber());
      } catch {
        return null;
      }
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
      if (location?.mode === "manual" && location.included?.length && !location.includedNames?.length && !location.excludedNames?.length && !draft.input.targeting.audience?.interestNames.length) {
        return resolveDraftTargeting(draft.input, [], async () => { throw new Error("Unexpected named location lookup."); });
      }
      const { data: business } = await supabase
        .from("businesses")
        .select("locations")
        .eq("id", actor.businessId)
        .maybeSingle();
      const names = location?.includedNames?.length ? location.includedNames : business?.locations ?? [];
      if (!names.length && !location?.included?.length) return { resolvedAreaLabel: null, unresolvedNames: [], explicitlyNationwide: false };
      const connection = await getConnectionStatus(authorizedBusiness);
      if (connection.capabilities.canCreatePaused.state !== "available") {
        return { resolvedAreaLabel: null, unresolvedNames: names, explicitlyNationwide: false };
      }
      return withMetaConnection(
        authorizedBusiness,
        { purpose: "create_paused" },
        async (meta) => {
          const geo = await resolveDraftTargeting(draft.input, business?.locations ?? [], meta.resolveGeoTargeting.bind(meta));
          const names = draft.input.targeting.audience?.interestNames ?? [];
          if (!names.length) return geo;
          try {
            const audience = await meta.resolveAudienceInterests(names);
            return { ...geo, audienceInterests: audience.interests, unresolvedInterests: audience.unresolved };
          } catch {
            return { ...geo, audienceInterests: [], unresolvedInterests: names };
          }
        },
      );
    },
    hash: (payload) => createHash("sha256").update(payload).digest("hex"),
  };
}