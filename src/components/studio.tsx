"use client";

import { useEffect, useState, useTransition } from "react";
import {
  CheckCircle2,
  Download,
  Eye,
  ImageIcon,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
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
import { useSessionDraft } from "@/lib/use-session-draft";
import { cn } from "@/lib/utils";

export function Studio({
  business,
  initialCreatives,
}: {
  business: Business;
  initialCreatives: Creative[];
}) {
  const [items, setItems] = useState<Creative[]>(initialCreatives);
  // Survives a tab change so a long brief isn't retyped. Kept after generating,
  // since tweaking the brief and regenerating is the normal flow.
  const [brief, setBrief] = useSessionDraft<string>(
    `adbrain:studio-brief:${business.id}`,
    "",
    (raw) => (typeof raw === "string" ? raw : null),
  );
  const [count, setCount] = useState(3);
  const [language, setLanguage] = useState("brand");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportOk, setExportOk] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const approvedCount = items.filter((i) => i.status === "approved").length;
  const reviewCount = items.length - approvedCount;
  const previewCreative = items.find((item) => item.id === previewId) ?? null;
  const workflowStep = generating
    ? 2
    : items.length === 0
      ? 1
      : approvedCount === items.length
        ? 4
        : approvedCount
          ? 3
          : 2;

  useEffect(() => {
    if (!previewCreative) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setPreviewId(null);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [previewCreative]);

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
      <div className="flex flex-col gap-3 border-b border-slate-200/80 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">
            Production workspace
          </p>
          <h2 className="mt-1 font-display text-xl font-semibold tracking-[-0.02em] text-slate-950">
            Create, review, and prepare your ads
          </h2>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-slate-500">
            <strong className="font-semibold text-slate-900">{reviewCount}</strong> to review
          </span>
          <span className="text-slate-500">
            <strong className="font-semibold text-blue-700">{approvedCount}</strong> ready
          </span>
        </div>
      </div>
      <ol
        aria-label="Creative workflow"
        className="grid grid-cols-4 overflow-hidden rounded-2xl border border-slate-200 bg-white/80 shadow-[0_8px_20px_rgba(15,23,42,0.03)]"
      >
        {[
          ["01", "Brief", "Set the campaign goal"],
          ["02", "Generate", "Create on-brand variants"],
          ["03", "Review", `${reviewCount} awaiting approval`],
          ["04", "Export", `${approvedCount} ready for launch`],
        ].map(([number, label, detail], index) => (
          <li
            key={label}
            className={cn(
              "min-w-0 border-r border-slate-200 px-3 py-3 last:border-r-0 sm:px-4",
              workflowStep === index + 1 ? "bg-slate-950 text-white" : "text-slate-600",
            )}
          >
            <span className={cn(
              "text-[10px] font-semibold tracking-[0.14em]",
              workflowStep === index + 1 ? "text-amber-300" : "text-slate-400",
            )}>{number}</span>
            <p className="mt-1 truncate text-sm font-semibold">{label}</p>
            <p className={cn(
              "mt-0.5 hidden truncate text-xs sm:block",
              workflowStep === index + 1 ? "text-slate-300" : "text-slate-500",
            )}>{detail}</p>
          </li>
        ))}
      </ol>
      <Card className="overflow-hidden border-slate-200 bg-[linear-gradient(135deg,#ffffff_0%,#f5f0e9_100%)] shadow-[0_14px_30px_rgba(15,23,42,0.06)]">
        <CardContent className="p-5 sm:p-6">
          <form onSubmit={generate} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <div>
                <Label htmlFor="brief">What are we advertising?</Label>
                <p className="mt-1 text-sm text-slate-500">
                  Give the campaign a goal, offer, audience, or moment to build around.
                </p>
              </div>
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
        <Card className="border-dashed border-slate-300 bg-white/60">
          <CardContent className="flex flex-col items-center gap-1 px-5 py-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white">
              <ImageIcon className="h-5 w-5" />
            </span>
            <p className="mt-3 text-lg font-semibold text-slate-900">Your review board is ready</p>
            <p className="max-w-md text-sm text-slate-500">
              Write a short brief above — what you’re selling and to whom — and
              generate your first batch. You’ll compare, approve, and export the
              strongest variants here.
            </p>
            <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs text-slate-500">
              {["Compare concepts", "Approve winners", "Export an ad pack"].map((item) => (
                <span key={item} className="rounded-full border border-slate-200 bg-white px-3 py-1.5">{item}</span>
              ))}
            </div>
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
              onPreview={() => setPreviewId(c.id)}
            />
          ))}
        </div>
      )}

      {previewCreative && (
        <CreativePreview
          businessName={business.name}
          creative={previewCreative}
          onClose={() => setPreviewId(null)}
        />
      )}
    </div>
  );
}

function CreativeCard({
  creative,
  onChange,
  onDelete,
  onPreview,
}: {
  creative: Creative;
  onChange: (c: Creative) => void;
  onDelete: (id: string) => void;
  onPreview: () => void;
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
        </div>
      </div>
      <CardContent className="flex flex-1 flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Badge
            className={
              approved
                ? "bg-blue-50 text-blue-700"
                : "bg-amber-50 text-amber-700"
            }
          >
            {approved ? "Approved" : "Needs review"}
          </Badge>
          {creative.angle && (
            <span className="truncate text-xs text-slate-400">{creative.angle}</span>
          )}
        </div>
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
            variant="outline"
            onClick={onPreview}
            aria-label={`Preview ${creative.headline ?? "creative"}`}
          >
            <Eye className="h-4 w-4" /> Preview
          </Button>
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

function CreativePreview({
  businessName,
  creative,
  onClose,
}: {
  businessName: string;
  creative: Creative;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="creative-preview-title"
        className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-t-xl bg-white shadow-2xl sm:rounded-xl"
      >
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-700">
              Meta feed preview
            </p>
            <h2 id="creative-preview-title" className="mt-0.5 text-lg font-semibold text-slate-950">
              Review before approval
            </h2>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close preview">
            <X className="h-5 w-5" />
          </Button>
        </header>

        <div className="grid lg:grid-cols-[1.15fr_0.85fr]">
          <div className="flex min-h-[320px] items-center justify-center bg-slate-100 p-5 sm:p-8">
            {creative.image_url ? (
              <img
                src={creative.image_url}
                alt={creative.headline ?? "Ad creative"}
                className="max-h-[62vh] w-full max-w-[620px] object-contain shadow-sm"
              />
            ) : (
              <div className="flex aspect-square w-full max-w-[520px] items-center justify-center bg-slate-200">
                <ImageIcon className="h-10 w-10 text-slate-400" />
              </div>
            )}
          </div>

          <div className="flex flex-col border-t border-slate-200 lg:border-l lg:border-t-0">
            <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-slate-900">{businessName}</p>
                  <p className="text-xs text-slate-500">Sponsored</p>
                </div>
                <Badge className={creative.status === "approved" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"}>
                  {creative.status === "approved" ? "Approved" : "Needs review"}
                </Badge>
              </div>
            </div>
            <div className="flex flex-1 flex-col gap-5 px-5 py-5 sm:px-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                  Primary text
                </p>
                <p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">
                  {creative.primary_text || "No primary text"}
                </p>
              </div>
              <div className="border-t border-slate-200 pt-5">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
                  Headline
                </p>
                <p className="mt-2 font-semibold text-slate-950">
                  {creative.headline || "No headline"}
                </p>
              </div>
              <div className="mt-auto flex items-center justify-between gap-3 border-t border-slate-200 pt-5">
                <span className="text-xs text-slate-500">Facebook and Instagram feed</span>
                {creative.cta && (
                  <span className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white">
                    {creative.cta}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
