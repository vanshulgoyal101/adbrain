"use client";

import { useRef, useState } from "react";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { creativeImageFile, shareCreative } from "@/lib/share-creative";
import type { Creative } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Share an approved ad to WhatsApp, Instagram or anywhere the phone offers (#337). */
export function ShareCreativeButton({
  creative,
  className,
  variant = "primary",
  ...rest
}: {
  creative: Creative;
  className?: string;
  /** #1598: Review's card keeps one solid primary (Create campaign), so Share is outline there. */
  variant?: "primary" | "outline";
  "data-product-event"?: string;
}) {
  const file = useRef<{ url: string | null; promise: Promise<File> } | null>(null);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Fetch early: iOS only opens the share sheet if share() runs right after the tap.
  function prefetch() {
    if (file.current?.url === creative.image_url) return file.current.promise;
    const promise = creativeImageFile(creative);
    promise.catch(() => {
      if (file.current?.promise === promise) file.current = null;
    });
    file.current = { url: creative.image_url, promise };
    return promise;
  }

  async function share() {
    setStatus(null);
    setBusy(true);
    try {
      const outcome = await shareCreative(creative, await prefetch());
      if (outcome.kind === "saved")
        setStatus({ tone: "ok", text: outcome.copied ? "Picture downloaded and text copied. Paste it with the picture." : "Picture downloaded." });
    } catch (error) {
      setStatus(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? { tone: "ok", text: "Your picture is ready. Tap Share again." }
          : { tone: "error", text: "Couldn't prepare the picture. Check your connection and try again." },
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <Button
        type="button"
        size="sm"
        variant={variant}
        onPointerDown={() => void prefetch().catch(() => undefined)}
        onFocus={() => void prefetch().catch(() => undefined)}
        onClick={share}
        disabled={busy || !creative.image_url}
        className="h-11 w-full"
        {...rest}
      >
        <Share2 className="h-4 w-4" /> Share to WhatsApp or Instagram
      </Button>
      {status && (
        <p role="status" className={cn("text-xs", status.tone === "error" ? "text-red-600" : "text-slate-600")}>
          {status.text}
        </p>
      )}
    </div>
  );
}
