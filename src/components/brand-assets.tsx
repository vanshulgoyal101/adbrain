"use client";

import { useRef, useState } from "react";
import { Trash2, Upload } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { createClient } from "@/lib/supabase/client";
import type { BrandAsset, BrandAssetType } from "@/lib/types";

const BUCKET = "brand-assets";
const MAX_BYTES = 5 * 1024 * 1024;

const TYPE_LABELS: Record<BrandAssetType, string> = {
  logo: "Logo",
  product_photo: "Product photo",
  past_ad: "Past ad",
};

function sanitize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function BrandAssets({
  businessId,
  initialAssets,
}: {
  businessId: string;
  initialAssets: BrandAsset[];
}) {
  const supabase = createClient();
  const [assets, setAssets] = useState<BrandAsset[]>(initialAssets);
  const [type, setType] = useState<BrandAssetType>("logo");
  const [notes, setNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("File must be under 5 MB.");
      return;
    }

    setUploading(true);
    try {
      const path = `${businessId}/${type}/${crypto.randomUUID()}-${sanitize(file.name)}`;
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, {
          cacheControl: "3600",
          contentType: file.type || undefined,
          upsert: false,
        });
      if (upErr) {
        setError(upErr.message);
        return;
      }

      const url = supabase.storage.from(BUCKET).getPublicUrl(path).data
        .publicUrl;

      const { data: row, error: insErr } = await supabase
        .from("brand_assets")
        .insert({
          business_id: businessId,
          type,
          url,
          notes: notes.trim() || null,
        })
        .select("*")
        .single();
      if (insErr || !row) {
        setError(insErr?.message ?? "Could not save the asset.");
        return;
      }

      // A logo doubles as the brand's logo_url.
      if (type === "logo") {
        await supabase
          .from("businesses")
          .update({ logo_url: url })
          .eq("id", businessId);
      }

      setAssets((prev) => [row, ...prev]);
      setNotes("");
      setFileName(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function remove(asset: BrandAsset) {
    if (!window.confirm("Delete this asset?")) return;
    setError(null);
    const path = decodeURIComponent(asset.url.split(`/${BUCKET}/`)[1] ?? "");
    try {
      if (path) await supabase.storage.from(BUCKET).remove([path]);
      const { error: delErr } = await supabase
        .from("brand_assets")
        .delete()
        .eq("id", asset.id);
      if (delErr) {
        setError(delErr.message);
        return;
      }
      setAssets((prev) => prev.filter((a) => a.id !== asset.id));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Brand assets</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <form onSubmit={onUpload} className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="asset-type">Type</Label>
              <select
                id="asset-type"
                value={type}
                onChange={(e) => setType(e.target.value as BrandAssetType)}
                className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-emerald-500"
              >
                {(Object.keys(TYPE_LABELS) as BrandAssetType[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label>Notes (optional)</Label>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. main logo, dark background"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="asset-file">Image file</Label>
            <div className="flex flex-wrap items-center gap-3">
              <input
                id="asset-file"
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
                className="text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
              />
              <Button type="submit" disabled={uploading}>
                {uploading ? <Spinner /> : <Upload className="h-4 w-4" />}
                Upload
              </Button>
            </div>
            {fileName && (
              <p className="text-xs text-slate-400">Selected: {fileName}</p>
            )}
          </div>
          {error && <Alert variant="error">{error}</Alert>}
        </form>

        {assets.length === 0 ? (
          <p className="text-sm text-slate-500">
            No assets yet. Upload your logo, product photos, or past ads.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {assets.map((a) => (
              <div
                key={a.id}
                className="group relative overflow-hidden rounded-lg border border-slate-200"
              >
                <div className="aspect-square bg-slate-100">
                  <img
                    src={a.url}
                    alt={a.notes ?? TYPE_LABELS[a.type]}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </div>
                <Badge className="absolute left-1.5 top-1.5 bg-black/60 text-white backdrop-blur">
                  {TYPE_LABELS[a.type]}
                </Badge>
                <button
                  type="button"
                  onClick={() => remove(a)}
                  aria-label="Delete asset"
                  className="absolute right-1.5 top-1.5 rounded-md bg-black/60 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                {a.notes && (
                  <p className="truncate px-2 py-1.5 text-xs text-slate-500">
                    {a.notes}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
