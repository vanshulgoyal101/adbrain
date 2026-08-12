"use client";

import { useState } from "react";
import { Download, ExternalLink, ImageIcon, Link2 } from "lucide-react";
import { Badge, Card, CardContent } from "@/components/ui/card";
import type { BrandAsset, Creative } from "@/lib/types";
import { cn } from "@/lib/utils";

const ASSET_TYPE_LABEL: Record<string, string> = {
  logo: "Logo",
  product_photo: "Product photo",
  past_ad: "Past ad",
};

async function downloadImage(url: string, filename: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error();
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(objectUrl);
  } catch {
    // Fallback: open in a new tab if the fetch is blocked by CORS.
    window.open(url, "_blank", "noopener");
  }
}

function slugify(s: string, fallback: string): string {
  const base = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return base || fallback;
}

function AssetTile({
  url,
  title,
  badges,
  filename,
}: {
  url: string;
  title: string;
  badges?: { label: string; className?: string }[];
  filename: string;
}) {
  const [copied, setCopied] = useState(false);
  const [broken, setBroken] = useState(false);

  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="relative aspect-square bg-slate-100">
        {!broken ? (
          <img
            src={url}
            alt={title}
            loading="lazy"
            className="h-full w-full object-cover"
            onError={() => setBroken(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ImageIcon className="h-8 w-8 text-slate-300" />
          </div>
        )}
        {!!badges?.length && (
          <div className="absolute left-2 top-2 flex flex-wrap gap-1.5">
            {badges.map((b) => (
              <Badge
                key={b.label}
                className={cn("bg-black/60 text-white backdrop-blur", b.className)}
              >
                {b.label}
              </Badge>
            ))}
          </div>
        )}
      </div>
      <CardContent className="flex flex-col gap-2">
        <p className="truncate text-sm font-medium text-slate-800" title={title}>
          {title}
        </p>
        <div className="flex items-center gap-1 text-slate-500">
          <button
            type="button"
            onClick={() => downloadImage(url, filename)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium hover:bg-slate-100"
          >
            <Download className="h-3.5 w-3.5" /> Download
          </button>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium hover:bg-slate-100"
          >
            <Link2 className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy link"}
          </button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium hover:bg-slate-100"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Open
          </a>
        </div>
      </CardContent>
    </Card>
  );
}

export function AssetsLibrary({
  creatives,
  brandAssets,
}: {
  creatives: Creative[];
  brandAssets: BrandAsset[];
}) {
  const generated = creatives.filter((c) => c.image_url);

  return (
    <div className="flex flex-col gap-8">
      <section>
        <div className="mb-3 flex items-baseline gap-2">
          <h2 className="text-lg font-semibold text-slate-900">
            AI-generated creatives
          </h2>
          <span className="text-sm text-slate-400">({generated.length})</span>
        </div>
        {generated.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-slate-500">
              No generated images yet. Create some in the Creative Studio — every
              image you generate is saved here automatically.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {generated.map((c) => (
              <AssetTile
                key={c.id}
                url={c.image_url as string}
                title={c.headline ?? "Ad creative"}
                filename={`adbrain-${slugify(c.headline ?? c.angle ?? "creative", c.id.slice(0, 6))}.jpg`}
                badges={[
                  ...(c.angle ? [{ label: c.angle }] : []),
                  ...(c.status === "approved"
                    ? [{ label: "Approved", className: "bg-emerald-600" }]
                    : []),
                ]}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-baseline gap-2">
          <h2 className="text-lg font-semibold text-slate-900">
            Uploaded brand assets
          </h2>
          <span className="text-sm text-slate-400">({brandAssets.length})</span>
        </div>
        {brandAssets.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-slate-500">
              No uploads yet. Add your logo and product photos on the Brand Brain
              page.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {brandAssets.map((a) => (
              <AssetTile
                key={a.id}
                url={a.url}
                title={a.notes || ASSET_TYPE_LABEL[a.type] || "Asset"}
                filename={`adbrain-${slugify(a.type, a.id.slice(0, 6))}.png`}
                badges={[{ label: ASSET_TYPE_LABEL[a.type] ?? a.type }]}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
