"use client";

import { useState, useTransition } from "react";
import {
  CheckCircle2,
  Download,
  ImageIcon,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  deleteCreative,
  setCreativeStatus,
} from "@/app/(app)/studio/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent } from "@/components/ui/card";
import { Label, Textarea } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { AD_LANGUAGES } from "@/lib/languages";
import type { Business, Creative } from "@/lib/types";
import { downloadBlob } from "@/lib/download";
import { cn } from "@/lib/utils";

export function Studio({
  business,
  initialCreatives,
}: {
  business: Business;
  initialCreatives: Creative[];
}) {
  const [items, setItems] = useState<Creative[]>(initialCreatives);
  const [brief, setBrief] = useState("");
  const [count, setCount] = useState(3);
  const [language, setLanguage] = useState("brand");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportOk, setExportOk] = useState(false);

  const approvedCount = items.filter((i) => i.status === "approved").length;

  async function generate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!brief.trim()) {
      setError("Describe what you want to advertise.");
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch("/api/creatives/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: business.id, brief, count, language }),
      });
      const data = (await res.json()) as {
        creatives?: Creative[];
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Generation failed.");
        return;
      }
      setItems((prev) => [...(data.creatives ?? []), ...prev]);
    } catch {
      setError("Generation failed — check your connection and try again.");
    } finally {
      setGenerating(false);
    }
  }

  async function exportApproved() {
    const ids = items
      .filter((i) => i.status === "approved")
      .map((i) => i.id);
    if (!ids.length) return;
    setExporting(true);
    setExportOk(false);
    setError(null);
    try {
      const res = await fetch("/api/creatives/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creativeIds: ids }),
      });
      if (!res.ok) {
        setError("Export failed.");
        return;
      }
      const blob = await res.blob();
      downloadBlob(blob, "adbrain-ad-pack.zip");
      setExportOk(true);
    } catch {
      setError("Export failed.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardContent>
          <form onSubmit={generate} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="brief">What are we advertising?</Label>
              <Textarea
                id="brief"
                rows={3}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="e.g. Festive-season offer for customers in Pune. Emphasise the savings and a free consultation."
              />
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="count">Variants</Label>
                <select
                  id="count"
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                  className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500"
                >
                  {[3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="language">Language</Label>
                <select
                  id="language"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-blue-500"
                >
                  {AD_LANGUAGES.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" disabled={generating}>
                {generating ? <Spinner /> : <Sparkles className="h-4 w-4" />}
                {generating ? "Generating…" : "Generate ads"}
              </Button>
            </div>
            {error && <Alert variant="error">{error}</Alert>}
          </form>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">
          Creatives{" "}
          <span className="font-normal text-slate-400">({items.length})</span>
        </h2>
        <Button
          variant="outline"
          size="sm"
          onClick={exportApproved}
          disabled={approvedCount === 0 || exporting}
        >
          {exporting ? <Spinner /> : <Download className="h-4 w-4" />}
          Export approved ({approvedCount})
        </Button>
      </div>

      {exportOk && <Alert variant="success">Ad pack downloaded.</Alert>}

      {items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-1 py-12 text-center">
            <ImageIcon className="h-6 w-6 text-slate-300" />
            <p className="font-medium text-slate-600">No creatives yet</p>
            <p className="max-w-sm text-sm text-slate-400">
              Write a short brief above — what you’re selling and to whom — and
              generate your first batch of ads. You can approve, tweak, or
              regenerate any of them.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((c) => (
            <CreativeCard
              key={c.id}
              creative={c}
              onChange={(updated) =>
                setItems((prev) =>
                  prev.map((i) => (i.id === updated.id ? updated : i)),
                )
              }
              onDelete={(id) =>
                setItems((prev) => prev.filter((i) => i.id !== id))
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CreativeCard({
  creative,
  onChange,
  onDelete,
}: {
  creative: Creative;
  onChange: (c: Creative) => void;
  onDelete: (id: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [erroredUrl, setErroredUrl] = useState<string | null>(null);
  const approved = creative.status === "approved";
  const imgLoaded = loadedUrl === creative.image_url;
  const imgError = erroredUrl === creative.image_url;

  async function regenerate() {
    setRegenerating(true);
    setRegenError(null);
    try {
      const res = await fetch(`/api/creatives/${creative.id}/regenerate`, {
        method: "POST",
      });
      const data = (await res.json()) as { creative?: Creative; error?: string };
      if (res.ok && data.creative) onChange(data.creative);
      else setRegenError(data.error ?? "Couldn't regenerate — try again.");
    } catch {
      setRegenError("Couldn't regenerate — check your connection.");
    } finally {
      setRegenerating(false);
    }
  }

  function toggleApprove() {
    startTransition(async () => {
      const next = approved ? "draft" : "approved";
      const res = await setCreativeStatus(creative.id, next);
      if (res.ok) onChange({ ...creative, status: next });
    });
  }

  function remove() {
    if (!window.confirm("Delete this creative? This can't be undone.")) return;
    startTransition(async () => {
      const res = await deleteCreative(creative.id);
      if (res.ok) onDelete(creative.id);
    });
  }

  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="relative aspect-square bg-slate-100">
        {creative.image_url && !imgError && (
          <img
            key={creative.image_url}
            ref={(node) => {
              // Already-cached images may finish before React attaches onLoad;
              // detect that in the commit phase so we skip the placeholder flash.
              if (node?.complete && node.naturalWidth > 0) {
                setLoadedUrl(creative.image_url);
              }
            }}
            src={creative.image_url}
            alt={creative.headline ?? "Ad creative"}
            className={cn(
              "h-full w-full object-cover transition-opacity",
              imgLoaded ? "opacity-100" : "opacity-0",
            )}
            loading="lazy"
            onLoad={() => setLoadedUrl(creative.image_url)}
            onError={() => setErroredUrl(creative.image_url)}
          />
        )}
        {(!imgLoaded || imgError) && (
          <div className="absolute inset-0 flex items-center justify-center">
            {imgError ? (
              <ImageIcon className="h-8 w-8 text-slate-300" />
            ) : (
              <div className="h-full w-full animate-pulse bg-slate-200" />
            )}
          </div>
        )}
        {regenerating && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/60">
            <Spinner className="h-6 w-6 text-blue-600" />
          </div>
        )}
        <div className="absolute left-2 top-2 flex gap-1.5">
          {creative.angle && (
            <Badge className="bg-black/60 text-white backdrop-blur">
              {creative.angle}
            </Badge>
          )}
          {approved && (
            <Badge className="bg-blue-600 text-white">Approved</Badge>
          )}
        </div>
      </div>
      <CardContent className="flex flex-1 flex-col gap-2">
        <h3 className="font-semibold text-slate-900">{creative.headline}</h3>
        <p className="whitespace-pre-line text-sm text-slate-600">
          {creative.primary_text}
        </p>
        {creative.cta && (
          <span className="mt-1 inline-flex w-fit rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white">
            {creative.cta}
          </span>
        )}
        <div className="mt-auto flex items-center gap-2 pt-3">
          <Button
            size="sm"
            variant={approved ? "outline" : "primary"}
            onClick={toggleApprove}
            disabled={pending}
            className="flex-1"
          >
            {approved ? (
              <>
                <RotateCcw className="h-4 w-4" /> Unapprove
              </>
            ) : (
              <>
                <CheckCircle2 className="h-4 w-4" /> Approve
              </>
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={regenerate}
            disabled={pending || regenerating}
            aria-label="Regenerate creative"
          >
            {regenerating ? (
              <Spinner className="text-slate-400" />
            ) : (
              <RefreshCw className="h-4 w-4 text-slate-400" />
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={remove}
            disabled={pending}
            aria-label="Delete creative"
          >
            <Trash2 className="h-4 w-4 text-slate-400" />
          </Button>
        </div>
        {regenError && (
          <p className="text-xs text-red-600" role="alert">
            {regenError}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
