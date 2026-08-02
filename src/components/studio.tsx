"use client";

import { useState, useTransition } from "react";
import {
  CheckCircle2,
  Download,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  deleteCreative,
  setCreativeStatus,
} from "@/app/(app)/studio/actions";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardContent } from "@/components/ui/card";
import { Label, Textarea } from "@/components/ui/input";
import type { Business, Creative } from "@/lib/types";

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
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

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
        body: JSON.stringify({ businessId: business.id, brief, count }),
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
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "adbrain-ad-pack.zip";
      a.click();
      URL.revokeObjectURL(url);
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
                placeholder="e.g. Festive-season offer on rooftop solar for homeowners in Pune. Emphasise bill savings and free site survey."
              />
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="count">Variants</Label>
                <select
                  id="count"
                  value={count}
                  onChange={(e) => setCount(Number(e.target.value))}
                  className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-emerald-500"
                >
                  {[3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" disabled={generating}>
                {generating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {generating ? "Generating…" : "Generate ads"}
              </Button>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
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
          {exporting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Export approved ({approvedCount})
        </Button>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-500">
            No creatives yet. Write a brief above and generate your first batch.
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
  const approved = creative.status === "approved";

  async function regenerate() {
    setRegenerating(true);
    try {
      const res = await fetch(`/api/creatives/${creative.id}/regenerate`, {
        method: "POST",
      });
      const data = (await res.json()) as { creative?: Creative };
      if (res.ok && data.creative) onChange(data.creative);
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
    startTransition(async () => {
      const res = await deleteCreative(creative.id);
      if (res.ok) onDelete(creative.id);
    });
  }

  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="relative aspect-square bg-slate-100">
        {creative.image_url && (
          <img
            src={creative.image_url}
            alt={creative.headline ?? "Ad creative"}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        )}
        <div className="absolute left-2 top-2 flex gap-1.5">
          {creative.angle && (
            <Badge className="bg-black/60 text-white backdrop-blur">
              {creative.angle}
            </Badge>
          )}
          {approved && (
            <Badge className="bg-emerald-600 text-white">Approved</Badge>
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
              <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
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
      </CardContent>
    </Card>
  );
}
