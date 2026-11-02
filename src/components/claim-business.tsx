"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { creativeThumbnailUrl } from "@/lib/creative/thumbnail";
import type { PendingClaim } from "@/lib/prospect/transfer-server";

/**
 * #1670 (Designer #1736 frame 3): the owner, signed in on their own phone, is asked before anything else whether the
 * business AdBrain prepared is theirs. The name leads, so a stranger behind a mistyped email can say no.
 */
export function ClaimBusiness({ claim, email }: { claim: PendingClaim; email: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function answer(decision: "accept" | "decline") {
    setBusy(decision);
    setError(null);
    try {
      const response = await fetch("/api/prospect/claim", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ transferId: claim.transferId, decision }),
      });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? "Couldn't answer. Try again.");
      if (decision === "accept") router.replace("/dashboard?handed=1");
      router.refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't answer. Try again.");
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="claim-title" className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-5 sm:p-6">
      <h1 id="claim-title" className="text-2xl font-semibold leading-tight text-slate-950">Make {claim.businessName} yours?</h1>
      <p className="mt-3 text-sm text-slate-700">
        AdBrain set this up for you on today&apos;s visit: your business details and {claim.ads} {claim.ads === 1 ? "ad" : "ads"}. Making it yours signs everyone else out of it.
      </p>
      {claim.images.length > 0 && (
        <ul className="mt-4 grid grid-cols-3 gap-2">
          {claim.images.map((url) => (
            <li key={url} className="aspect-square overflow-hidden rounded-md bg-slate-100">
              <img src={creativeThumbnailUrl(url)} alt="One of your ads" className="h-full w-full object-cover" loading="lazy" />
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
      <Button className="mt-5 w-full" disabled={busy !== null} onClick={() => void answer("accept")}>
        {busy === "accept" ? "Making it yours…" : "Make it mine"}
      </Button>
      <Button variant="quiet" className="mt-2 w-full" disabled={busy !== null} onClick={() => void answer("decline")}>
        This isn&apos;t my business
      </Button>
      {email && <p className="mt-4 text-xs text-slate-500">Signed in as {email}</p>}
    </section>
  );
}
