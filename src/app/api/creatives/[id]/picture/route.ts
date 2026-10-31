import { observeRoute } from "@/lib/observability/logger";
import { NextResponse } from "next/server";
import { serverError } from "@/lib/api";
import { logEvent } from "@/lib/audit";
import { getEnv } from "@/lib/env";
import sharp from "sharp";
import { renderAndPersistDesign } from "@/lib/creative/persist";
import { renderCompositeAd } from "@/lib/creative/render";
import {
  pictureDesign,
  pictureWordsSchema,
  savedBackground,
  withPictureWords,
} from "@/lib/creative/picture-words";
import { rateLimitResponse } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { AD_ANGLES, getAngleByName } from "@/lib/templates/ads";
import type { Json } from "@/lib/types";
import { ownerError } from "@/i18n/request-locale";
import type { OwnerErrorKey } from "@/i18n/locale";

export const runtime = "nodejs";
export const maxDuration = 60;

export const POST = observeRoute("/api/creatives/[id]/picture", "POST", handlePOST);

const FIELD_NAMES: Record<string, OwnerErrorKey> = {
  headline: "pictureFieldHeadline",
  subhead: "pictureFieldSubhead",
  phone: "pictureFieldPhone",
  ctaLabel: "pictureFieldButton",
};


const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Re-renders the words printed on an ad's picture over its saved background. No AI call (#280). */
async function handlePOST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  // #387: `preview: true` renders the words for the editor's live preview and saves nothing.
  const preview = (body as { preview?: unknown } | null)?.preview === true;
  const parsed = pictureWordsSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = await ownerError(FIELD_NAMES[String(issue?.path[0])] ?? "pictureFieldOther");
    const message = issue?.code === "too_small"
      ? await ownerError("pictureFieldEmpty", { field })
      : issue?.code === "too_big"
        ? await ownerError("pictureFieldTooLong", { field, max: Number(issue.maximum) })
        : issue?.path[0] === "phone" ? await ownerError("phoneInvalid") : await ownerError("pictureFieldInvalid", { field });
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const limited = await rateLimitResponse(preview ? `picture-preview:${user.id}` : `picture:${user.id}`, { limit: preview ? 120 : 30, windowMs: 5 * 60_000 });
  if (limited) return limited;

  if (!getEnv().AD_DESIGN_OVERLAY)
    return NextResponse.json({ error: await ownerError("pictureNoWords") }, { status: 409 });

  const { data: creative } = await supabase
    .from("creatives")
    .select("id, business_id, variant_group, angle, image_url, headline, primary_text, cta, generation")
    .eq("id", id)
    .maybeSingle();
  if (!creative) return NextResponse.json({ error: await ownerError("adNotFound") }, { status: 404 });
  const { data: business } = await supabase
    .from("businesses")
    .select("*")
    .eq("id", creative.business_id)
    .maybeSingle();
  if (!business) return NextResponse.json({ error: await ownerError("businessNotFound") }, { status: 404 });

  const generation = isRecord(creative.generation) ? creative.generation : {};
  if (generation.composition === "image-only")
    return NextResponse.json({ error: await ownerError("pictureNoWords") }, { status: 409 });

  const angle = getAngleByName(creative.angle ?? "") ?? AD_ANGLES[0];
  const photoUrl = await savedBackground(supabase, creative, generation, angle.id);
  if (!photoUrl)
    return NextResponse.json(
      { error: await ownerError("noOriginalBackground"), code: "no_background" },
      { status: 409 },
    );

  const design = withPictureWords(pictureDesign(creative, business), parsed.data);
  if (preview) {
    try {
      const bytes = await renderCompositeAd({ ...design, backgroundUrl: photoUrl });
      const small = await sharp(Buffer.from(bytes)).resize({ width: 720, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
      return NextResponse.json({ previewUrl: `data:image/webp;base64,${small.toString("base64")}` });
    } catch (error) {
      return serverError("creative.picture.preview", error, await ownerError("previewFailed"));
    }
  }
  let imageUrl: string;
  try {
    imageUrl = await renderAndPersistDesign(
      supabase,
      creative.business_id,
      creative.variant_group ?? id,
      angle.id,
      design,
      photoUrl,
    );
  } catch (error) {
    return serverError("creative.picture", error, await ownerError("redrawFailed"));
  }

  // Re-read so a text edit saved during the redraw isn't overwritten.
  const { data: fresh } = await supabase.from("creatives").select("generation").eq("id", id).maybeSingle();
  const latest = isRecord(fresh?.generation) ? fresh.generation : generation;
  const nextGeneration = JSON.parse(JSON.stringify({
    ...latest,
    design: { ...design, backgroundUrl: undefined },
    photoUrl,
    pictureEditedAt: new Date().toISOString(),
  })) as Json;
  const { data: updated, error } = await supabase
    .from("creatives")
    .update({ image_url: imageUrl, generation: nextGeneration })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error || !updated)
    return serverError("creative.picture", error ?? new Error("Creative update returned no row"), await ownerError("pictureNotSaved"));

  const { data: live } = await supabase
    .from("campaigns")
    .select("id")
    .eq("business_id", creative.business_id)
    .contains("creative_ids", [id])
    .not("meta_campaign_id", "is", null)
    .limit(1);

  await logEvent({
    businessId: creative.business_id,
    action: "creative.edit_picture",
    entityType: "creative",
    entityId: id,
  });
  return NextResponse.json({
    creative: updated,
    ...(live?.length ? { liveNotice: await ownerError("liveEditNotice") } : {}),
  });
}
