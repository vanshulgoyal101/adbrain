import { createHash } from "node:crypto";
import { hasStoryDesign, savedBackground, storedPictureDesign } from "@/lib/creative/picture-words";
import { renderAndPersistDesign } from "@/lib/creative/persist";
import { logEvent } from "@/lib/audit";
import { getEnv } from "@/lib/env";
import { AD_ANGLES, getAngleByName } from "@/lib/templates/ads";
import type { Json } from "@/lib/types";
import { getCostPerResult } from "@/lib/campaign/result-evidence-store";
import { getConnectionStatus, withMetaConnection, type AuthorizedBusiness } from "@/lib/meta/connection-access";
import { draftRecordFromRow } from "@/lib/campaign/draft-store";
import { whatsappNumberForBusiness } from "@/lib/meta/whatsapp-bindings";
import type { PreflightLoaders } from "@/lib/campaign/preflight-service";
import type { createClient } from "@/lib/supabase/server";
import { resolveDraftTargeting } from "./draft-targeting";
import { savedCreativeDescription } from "@/lib/creative/concept";
import { campaignWhatsAppMessage } from "./campaign-whatsapp-message";
import { whatsappOpeningProblem, whatsappTemplateProblem } from "./whatsapp-template-check";

export type CampaignSupabase = Awaited<ReturnType<typeof createClient>>;

export function buildCampaignPreflightLoaders(
  supabase: CampaignSupabase,
  authorizedBusiness: AuthorizedBusiness,
): PreflightLoaders {
  // #366: one connection read per preflight; four loaders used to read it separately.
  let connectionStatus: ReturnType<typeof getConnectionStatus> | undefined;
  const status = () => (connectionStatus ??= getConnectionStatus(authorizedBusiness));
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
        .select("id, business_id, status, image_url, headline, primary_text, cta, generation")
        .in("id", creativeIds)
        .eq("business_id", businessId);
      return (data ?? []).map((creative) => ({
        id: creative.id,
        businessId: creative.business_id,
        approved: creative.status === "approved",
        imageUrl: creative.image_url,
        headline: creative.headline,
        primaryText: creative.primary_text,
        description: savedCreativeDescription(creative.generation),
        cta: creative.cta,
        storyReady: hasStoryDesign(creative.generation),
        asksWhatsApp: storedPictureDesign((creative.generation as { design?: unknown } | null)?.design)?.contact === "whatsapp",
        printedPhone: storedPictureDesign((creative.generation as { design?: unknown } | null)?.design)?.phone ?? null,
      }));
    },
    redrawPictureNumber: (actor, creativeId, phone) => redrawPictureNumber(supabase, actor.businessId, creativeId, phone),
    findCostPerResult: (actor, destination) => getCostPerResult(actor.businessId, destination),
    findForm: async (businessId, formId) => {
      const connection = await status();
      if (connection.capabilities.canCreatePaused.state !== "available") return null;
      const form = await withMetaConnection(
        authorizedBusiness,
        { purpose: "create_paused" },
        (meta) => meta.readActiveLeadForm(formId),
      );
      return form ? { id: form.id, businessId, active: true } : null;
    },
    findWhatsAppNumber: async (_actor, requested) => {
      const connection = await status();
      if (connection.capabilities.canCreatePaused.state !== "available") return null;
      // #681: a failed read throws (Review says try again); swallowing it told the owner to link a number they had linked.
      return withMetaConnection(authorizedBusiness, { purpose: "create_paused" }, (meta) => whatsappNumberForBusiness(authorizedBusiness.businessId, meta, requested ?? null));
    },
    findWhatsAppMessage: async (actor, draft) => {
      const [{ data: business, error }, { data: creatives }] = await Promise.all([
        supabase.from("businesses").select("name, offers, usps, description, vertical, locations, whatsapp_template").eq("id", actor.businessId).maybeSingle(),
        supabase.from("creatives").select("id, image_url, headline, primary_text, generation").in("id", draft.creativeIds).eq("business_id", actor.businessId),
      ]);
      if (error || !business) return null;
      // The same ads, in the same order, as launch writes the suggestion from.
      const byId = new Map((creatives ?? []).map((creative) => [creative.id, creative]));
      const used = draft.creativeIds.map((id) => byId.get(id)).filter((creative): creative is NonNullable<typeof creative> => Boolean(creative?.image_url && creative.headline));
      const message = campaignWhatsAppMessage({ draft, business, creatives: used });
      // A saved message was checked when it was saved, and this campaign's edit is checked here. #2422: whatever
      // launch sends (suggested and saved too) also meets the ad text's policy rules, since Meta reviews it with the ad.
      const edited = draft.whatsappMessage ? whatsappTemplateProblem(draft.whatsappMessage, business)?.error ?? null : null;
      const problem = edited ?? whatsappOpeningProblem(message.opening, business)?.error ?? null;
      return { message, problem };
    },
    findWebsite: async (actor) => {
      const { data } = await supabase.from("businesses").select("website").eq("id", actor.businessId).maybeSingle();
      return data?.website ?? null;
    },
    findBrandFacts: async (actor) => {
      const { data } = await supabase.from("businesses").select("usps, description").eq("id", actor.businessId).maybeSingle();
      return [...(data?.usps ?? []), data?.description ?? ""].filter((fact): fact is string => typeof fact === "string" && fact.trim() !== "");
    },
    findVertical: async (actor) => {
      const { data } = await supabase.from("businesses").select("vertical").eq("id", actor.businessId).maybeSingle();
      return data?.vertical ?? null;
    },
    getConnection: async () => {
      const connection = await status();
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
      const connection = await status();
      if (connection.capabilities.canCreatePaused.state !== "available") {
        return { resolvedAreaLabel: null, unresolvedNames: names, explicitlyNationwide: false };
      }
      return withMetaConnection(
        authorizedBusiness,
        { purpose: "create_paused" },
        async (meta) => {
          const names = draft.input.targeting.audience?.interestNames ?? [];
          // #271: geo and interest searches are independent, so they run together.
          const [geo, audience] = await Promise.all([
            resolveDraftTargeting(draft.input, business?.locations ?? [], meta.resolveGeoTargeting.bind(meta)),
            names.length ? meta.resolveAudienceInterests(names).catch(() => null) : null,
          ]);
          // #741: Review shows the exclusions launch will add; a failed read only drops the line.
          const areaExclusions = await Promise.resolve().then(() => meta.serviceAreaExclusionsFor(geo.location)).catch(() => null);
          const located = { ...geo, areaExclusions };
          if (!names.length) return located;
          return audience
            ? { ...located, audienceInterests: audience.interests, unresolvedInterests: audience.unresolved }
            : { ...located, audienceInterests: [], unresolvedInterests: names };
        },
      );
    },
    hash: (payload) => createHash("sha256").update(payload).digest("hex"),
  };
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * #2274: redraws the phone printed on one ad's saved design over its own background, like the owner's
 * picture edit (#280), and saves it on the ad. Null when the ad has no words or background to redraw.
 */
async function redrawPictureNumber(supabase: CampaignSupabase, businessId: string, creativeId: string, phone: string): Promise<string | null> {
  if (!getEnv().AD_DESIGN_OVERLAY) return null;
  const { data: creative } = await supabase
    .from("creatives")
    .select("id, business_id, variant_group, angle, image_url, generation")
    .eq("id", creativeId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (!creative) return null;
  const generation = isRecord(creative.generation) ? creative.generation : {};
  const stored = storedPictureDesign(generation.design);
  if (!stored?.phone || generation.composition === "image-only") return null;
  const angle = getAngleByName(creative.angle ?? "") ?? AD_ANGLES[0];
  const photoUrl = await savedBackground(supabase, creative, generation, angle.id);
  if (!photoUrl) return null;
  const design = { ...stored, phone };
  const imageUrl = await renderAndPersistDesign(supabase, businessId, creative.variant_group ?? creative.id, angle.id, design, photoUrl);
  // Re-read so a text edit saved during the redraw isn't overwritten.
  const { data: fresh } = await supabase.from("creatives").select("generation").eq("id", creativeId).maybeSingle();
  const latest = isRecord(fresh?.generation) ? fresh.generation : generation;
  const nextGeneration = JSON.parse(JSON.stringify({ ...latest, design: { ...design, backgroundUrl: undefined }, photoUrl })) as Json;
  const { data: updated, error } = await supabase
    .from("creatives")
    .update({ image_url: imageUrl, generation: nextGeneration })
    .eq("id", creativeId)
    .eq("business_id", businessId)
    .select("id")
    .maybeSingle();
  if (error || !updated) return null;
  await logEvent({ businessId, action: "creative.edit_picture", entityType: "creative", entityId: creativeId });
  return imageUrl;
}
