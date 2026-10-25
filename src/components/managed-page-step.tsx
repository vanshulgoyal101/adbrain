"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type PageOption = { id: string; name: string };
type Data = { pages: PageOption[]; createUrl: string; linked: { pageId: string; state: string } | null };

async function fetchPages(attemptId: string): Promise<Data> {
  const response = await fetch(`/api/meta/managed/page?attemptId=${encodeURIComponent(attemptId)}`, { cache: "no-store" });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) throw new Error(body?.error?.message ?? "Your Pages couldn't be loaded.");
  return body.data as Data;
}

/**
 * #523 (2-Tier): the customer's Facebook Page step. Lists Pages they administer from their Meta
 * connection attempt; without one, opens Meta's Page creator and checks again. #526 mounts it.
 */
export function ManagedPageStep({ attemptId, onLinked }: { attemptId: string; onLinked?: (pageId: string) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState<"load" | "check" | string | null>("load");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchPages(attemptId)
      .then((loaded) => { if (live) setData(loaded); })
      .catch((reason: Error) => { if (live) setError(reason.message); })
      .finally(() => { if (live) setBusy(null); });
    return () => { live = false; };
  }, [attemptId]);

  async function checkAgain() {
    setBusy("check");
    setError(null);
    try {
      const attempt = await (await fetch(`/api/meta/connections/attempts/${attemptId}`, { cache: "no-store" })).json();
      const retry = await fetch(`/api/meta/connections/attempts/${attemptId}/retry`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ revision: attempt?.data?.revision }),
      });
      if (!retry.ok) throw new Error("Facebook didn't answer yet. Try Check again in a moment.");
      setData(await fetchPages(attemptId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Facebook didn't answer yet.");
    } finally {
      setBusy(null);
    }
  }

  async function link(page: PageOption) {
    setBusy(page.id);
    setError(null);
    try {
      const response = await fetch("/api/meta/managed/page", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ attemptId, pageId: page.id }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || !body?.ok) throw new Error(body?.error?.message ?? "Your Page couldn't be saved. Try again.");
      setData((current) => current && { ...current, linked: { pageId: page.id, state: body.data.state } });
      onLinked?.(page.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Your Page couldn't be saved. Try again.");
    } finally {
      setBusy(null);
    }
  }

  if (busy === "load") return <p role="status" className="flex items-center gap-2 text-sm text-slate-600"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Finding your Facebook Pages…</p>;

  const linkedPage = data?.linked ? data.pages.find((page) => page.id === data.linked!.pageId) : undefined;
  return (
    <section aria-label="Your Facebook Page" className="flex flex-col gap-3">
      {data?.linked ? (
        <p role="status" className="flex items-center gap-2 text-sm font-medium text-green-800">
          <CheckCircle2 className="h-5 w-5" aria-hidden="true" />{linkedPage?.name ?? "Your Page"} is linked. Your ads will run from it.
        </p>
      ) : data?.pages.length ? (
        <>
          <p className="text-sm text-slate-700">Choose the Page your ads should come from.</p>
          <ul className="flex flex-col gap-2">
            {data.pages.map((page) => (
              <li key={page.id}>
                <Button variant="outline" className="w-full justify-start" disabled={busy !== null} onClick={() => void link(page)} aria-label={`Use ${page.name}`}>
                  {busy === page.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{page.name}
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-slate-700">Your ads need a Facebook Page for your business. Create one on Facebook (about 2 minutes), then come back and check again.</p>
      )}
      {!data?.linked && (
        <div className="flex flex-wrap gap-2">
          <a href={data?.createUrl ?? "https://www.facebook.com/pages/create/"} target="_blank" rel="noopener noreferrer"
            className="inline-flex h-11 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-900 hover:bg-slate-50">
            <ExternalLink className="h-4 w-4" aria-hidden="true" />Create a Page on Facebook
          </a>
          <Button variant="quiet" onClick={() => void checkAgain()} disabled={busy !== null}>
            {busy === "check" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}Check again
          </Button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </section>
  );
}
