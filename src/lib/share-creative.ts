import { downloadBlob } from "@/lib/download";
import type { Creative } from "@/lib/types";

type Shareable = Pick<Creative, "headline" | "primary_text" | "image_url">;

/** The post text people paste under the picture on WhatsApp or Instagram. */
export function shareText(creative: Shareable): string {
  return [creative.headline, creative.primary_text].map((part) => part?.trim()).filter(Boolean).join("\n\n");
}

function fileName(creative: Shareable, type: string): string {
  const slug = (creative.headline ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "adbrain-ad"}.${type.includes("png") ? "png" : "jpg"}`;
}

/** Fetches the full-size picture as a File, ready for the share sheet. */
export async function creativeImageFile(creative: Shareable): Promise<File> {
  if (!creative.image_url) throw new Error("This ad has no picture yet.");
  const res = await fetch(creative.image_url);
  if (!res.ok) throw new Error(`Image HTTP ${res.status}`);
  let blob = await res.blob();
  if (blob.type === "image/webp") {
    const image = await createImageBitmap(blob);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Cannot prepare a JPEG picture.");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
      blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((jpeg) => {
          if (!jpeg || jpeg.type !== "image/jpeg") reject(new Error("Cannot encode a JPEG picture."));
          else resolve(jpeg);
        }, "image/jpeg", 0.92);
      });
    } finally {
      image.close();
    }
  }
  const type = blob.type || "image/png";
  return new File([blob], fileName(creative, type), { type });
}

export type ShareOutcome = { kind: "shared" } | { kind: "cancelled" } | { kind: "saved"; copied: boolean };

/**
 * Opens the phone's share sheet with the picture and text (#337). Where files
 * can't be shared (most desktops), downloads the picture and copies the text.
 */
export async function shareCreative(creative: Shareable, file: File): Promise<ShareOutcome> {
  const text = shareText(creative);
  const data: ShareData = { files: [file], text, title: creative.headline ?? undefined };
  if (typeof navigator.share === "function" && navigator.canShare?.(data)) {
    try {
      await navigator.share(data);
      return { kind: "shared" };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return { kind: "cancelled" };
      throw error;
    }
  }
  downloadBlob(file, file.name);
  const copied = await navigator.clipboard?.writeText(text).then(() => true, () => false) ?? false;
  return { kind: "saved", copied };
}
