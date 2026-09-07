import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
  preflightRequestSchema,
} from "@/lib/campaign/connect-contracts";
import {
  draftRecordFromRow,
} from "@/lib/campaign/draft-store";
import { prepareCampaignReview } from "@/lib/campaign/preflight-service";
import {
  ConnectionAccessError,
  getConnectionStatus,
  requireOwnedBusiness,
  withMetaConnection,
} from "@/lib/meta/connection-access";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function errorResponse(
  requestId: string,
  status: number,
  code: "UNAUTHENTICATED" | "NOT_FOUND" | "FORBIDDEN" | "INVALID_INPUT" | "CONFLICT" | "UNAVAILABLE",
  message: string,
  retryable = false,
) {
  return NextResponse.json(
    { ok: false, error: { code, message, retryable }, requestId },
    { status },
  );
}

function hashReviewPayload(payload: string): string {
  return createHash("sha256").update(payload).digest("hex");
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return errorResponse(requestId, 401, "UNAUTHENTICATED", "Sign in required.");

  const parsed = preflightRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(requestId, 400, "INVALID_INPUT", "A valid business, draft, and version are required.");

  let actor;
  try {
    actor = await requireOwnedBusiness(parsed.data.businessId);
  } catch (error) {
    if (error instanceof ConnectionAccessError) {
      const status = error.code === "UNAUTHENTICATED" ? 401 : error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : 503;
      return errorResponse(requestId, status, error.code === "NOT_FOUND" ? "NOT_FOUND" : error.code, error.message, status >= 500);
    }
    return errorResponse(requestId, 503, "UNAVAILABLE", "Business access could not be checked.", true);
  }

  try {
    const result = await prepareCampaignReview(
      {
        findDraft: async (currentActor, draftId) => {
          const { data } = await supabase
            .from("campaign_drafts")
            .select("*")
            .eq("id", draftId)
            .eq("business_id", currentActor.businessId)
            .eq("owner_id", currentActor.userId)
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
          const context = actor;
          const forms = await withMetaConnection(
            context,
            { purpose: "create_paused" },
            (meta) => meta.listLeadForms(),
          );
          const form = forms.find((candidate) => candidate.id === formId);
          return form
            ? { id: form.id, businessId, active: form.status.toUpperCase() === "ACTIVE" }
            : null;
        },
        getConnection: async () => {
          const connection = await getConnectionStatus(actor);
          return {
            generation: connection.generation,
            selected: connection.selected,
            canCreatePaused: connection.capabilities.canCreatePaused.state === "available",
          };
        },
        resolveGeo: async (currentActor, draft) => {
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
            .eq("id", currentActor.businessId)
            .maybeSingle();
          const names = business?.locations ?? [];
          if (!names.length) {
            return { resolvedAreaLabel: null, unresolvedNames: [], explicitlyNationwide: false };
          }
          return withMetaConnection(
            actor,
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
        hash: hashReviewPayload,
      },
      {
        actor,
        draftId: parsed.data.draftId,
        requestedDraftVersion: parsed.data.draftVersion,
        now: new Date().toISOString(),
      },
    );

    if (result.kind === "not_found") return errorResponse(requestId, 404, "NOT_FOUND", "Draft not found.");
    if (result.kind === "forbidden") return errorResponse(requestId, 403, "FORBIDDEN", "Draft access is not allowed.");
    if (result.kind === "stale") return errorResponse(requestId, 409, "CONFLICT", "Draft changed in another tab. Review the latest version.", true);
    return NextResponse.json(
      { ok: true, data: result.review, requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ConnectionAccessError) {
      const status = error.code === "CONFLICT" ? 409 : error.code === "UNAUTHENTICATED" ? 401 : 503;
      return errorResponse(requestId, status, error.code === "CONFLICT" ? "CONFLICT" : error.code, error.message, status >= 500);
    }
    return errorResponse(requestId, 503, "UNAVAILABLE", "Campaign preparation is unavailable.", true);
  }
}