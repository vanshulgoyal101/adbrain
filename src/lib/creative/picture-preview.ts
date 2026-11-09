import "server-only";
import { createHash } from "node:crypto";
import sharp from "sharp";
import type { AdDesignSpec } from "./design";
import { renderCompositeAd } from "./render";

const pending = new Map<string, Promise<string>>();
const MAX_PENDING = 32;

/** Call only after request auth, tenant-scoped lookups and rate limiting. No completed image cache. */
export function renderPicturePreview(userId: string, creativeId: string, design: AdDesignSpec): Promise<string> {
  const key = createHash("sha256").update(JSON.stringify([userId, creativeId, design])).digest("hex");
  const existing = pending.get(key);
  if (existing) return existing;
  const render = async () => {
    const bytes = await renderCompositeAd(design);
    // Keep final-size typography/shaping: smaller layout dimensions can change line wrapping.
    const webp = await sharp(Buffer.from(bytes)).resize({ width: 720, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
    return `data:image/webp;base64,${webp.toString("base64")}`;
  };
  // Bound bookkeeping, not authorization or availability: excess distinct requests retain the normal path.
  if (pending.size >= MAX_PENDING) return render();
  const result = render().finally(() => { pending.delete(key); });
  pending.set(key, result);
  return result;
}
