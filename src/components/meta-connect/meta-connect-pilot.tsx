"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, CheckCircle2, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MetaConnectDialog } from "./meta-connect-dialog";
import type { ConnectionDTO } from "@/lib/meta/connect-contracts";

export function MetaConnectPilot({ businessName, connection: initialConnection }: {
  businessName: string;
  connection: ConnectionDTO;
}) {
  const [connection, setConnection] = useState(initialConnection);
  const [open, setOpen] = useState(false);
  const connected = connection.authorization === "connected" && connection.selected;
  return (
    <main className="mx-auto min-h-screen w-full max-w-2xl px-6 py-12">
      <Link href="/settings" className="inline-flex items-center gap-2 text-sm text-slate-600">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Settings
      </Link>
      <div className="mt-10 border-b border-slate-200 pb-6">
        <p className="text-sm font-medium text-slate-600">{businessName}</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">Meta connection</h1>
      </div>
      {connected && (
        <div className="flex items-start gap-3 py-6">
          <CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
          <div className="min-w-0 break-words">
            <p className="font-medium text-slate-900">{connected.accountName}</p>
            <p className="mt-1 text-sm text-slate-600">{connected.pageName}</p>
          </div>
        </div>
      )}
      <Button className="mt-6" onClick={() => setOpen(true)}>
        <Link2 className="h-4 w-4" aria-hidden="true" />
        {connected ? "Manage connection" : "Connect Meta"}
      </Button>
      <MetaConnectDialog businessId={connection.businessId} intent={{ kind: "setup" }} open={open}
        onClose={() => setOpen(false)} onConnected={(next) => { setConnection(next); setOpen(false); }} />
    </main>
  );
}