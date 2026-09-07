"use client";

import { useState } from "react";
import { CheckCircle2, Link2, RefreshCw } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetaConnectDialog } from "@/components/meta-connect/meta-connect-dialog";
import type { MetaConnection } from "@/lib/meta/credentials";

export function MetaConnectionPanel({
  businessId,
  connection,
  oauthConfigured,
  notice,
}: {
  businessId?: string;
  connection: MetaConnection;
  oauthConfigured: boolean;
  notice?: { kind: "success" | "error"; message: string };
}) {
  const [dialogOpen, setDialogOpen] = useState(false);

  async function disconnect() {
    if (!window.confirm("Disconnect this Meta business? This does not pause ads already running in Meta.")) return;
    await fetch("/api/meta/disconnect", { method: "POST" });
    window.location.reload();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-5 w-5 text-blue-600" aria-hidden="true" />
          Meta connection
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {notice && <Alert variant={notice.kind === "error" ? "error" : "success"}>{notice.message}</Alert>}
        {connection.source === "env" && (
          <Alert variant="warning">This workspace uses a server-managed Meta connection.</Alert>
        )}
        {connection.source === "oauth" && connection.expired && (
          <Alert variant="warning">Your Meta connection needs to be renewed.</Alert>
        )}
        {connection.ready && (
          <div className="flex items-start gap-2 text-sm text-emerald-800">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Connected. Account and Page details are checked when you open the connection.</span>
          </div>
        )}
        {!connection.ready && connection.source !== "env" && (
          <p className="text-sm text-slate-600">
            Connect an existing Meta business to prepare campaigns. You can keep working on a draft first.
          </p>
        )}
        {!businessId && <Alert variant="warning">Set up your Brand Brain before connecting Meta.</Alert>}
        {businessId && !oauthConfigured && (
          <Alert variant="warning">Meta connection is not configured on this server yet.</Alert>
        )}
        <div className="flex flex-wrap gap-2">
          {businessId && oauthConfigured && (
            <Button onClick={() => setDialogOpen(true)}>
              {connection.ready || connection.expired ? <RefreshCw className="h-4 w-4" aria-hidden="true" /> : <Link2 className="h-4 w-4" aria-hidden="true" />}
              {connection.ready ? "Manage connection" : connection.expired ? "Reconnect" : "Connect Business"}
            </Button>
          )}
          {connection.source === "oauth" && (
            <Button variant="danger" size="sm" onClick={() => void disconnect()}>
              Disconnect
            </Button>
          )}
        </div>
        {businessId && (
          <MetaConnectDialog
            businessId={businessId}
            intent={{ kind: "setup" }}
            open={dialogOpen}
            onClose={() => setDialogOpen(false)}
            onConnected={() => window.location.reload()}
          />
        )}
      </CardContent>
    </Card>
  );
}
