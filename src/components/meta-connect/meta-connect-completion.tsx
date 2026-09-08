"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MetaConnectDialog } from "./meta-connect-dialog";
import type { AttemptDTO } from "@/lib/meta/connect-contracts";

export function MetaConnectCompletion({ attempt }: { attempt: AttemptDTO }) {
  const [connected, setConnected] = useState(attempt.state === "connected" && attempt.connection?.authorization === "connected");
  const [dialogOpen, setDialogOpen] = useState(attempt.state !== "connected");
  useEffect(() => {
    if (!window.opener || window.opener === window) return;
    window.opener.postMessage(
      { type: "adbrain.meta.complete", attemptId: attempt.attemptId },
      window.location.origin,
    );
  }, [attempt.attemptId]);

  const destination =
    attempt.intent.kind === "setup" ? "/settings" : "/campaigns";
  const hasOpener = typeof window !== "undefined" && Boolean(window.opener);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg items-center px-6 py-12">
      <section className="w-full rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex gap-3">
          {connected ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
            : <Link2 className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" aria-hidden="true" />}
          <div>
            <h1 className="text-lg font-semibold text-slate-900">{connected ? "Connected to Meta" : "Finish connecting Meta"}</h1>
            <p className="mt-2 text-sm text-slate-600">
              {connected ? "Your account is connected. No ads have been started." : "Your connection still needs attention."}
            </p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          {!connected && <Button onClick={() => setDialogOpen(true)}>Finish connection</Button>}
          {hasOpener ? (
            <Button variant="outline" onClick={() => window.close()}>Return to AdBrain</Button>
          ) : (
            <a href={destination} className="inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700">
              <ExternalLink className="h-4 w-4" aria-hidden="true" /> Continue in AdBrain
            </a>
          )}
        </div>
      </section>
      {!connected && <MetaConnectDialog
        businessId={attempt.businessId}
        intent={attempt.intent}
        initialAttempt={attempt}
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onConnected={() => { setConnected(true); setDialogOpen(false); }}
      />}
    </main>
  );
}