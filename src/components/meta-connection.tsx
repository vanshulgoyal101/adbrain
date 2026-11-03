"use client";

import { reconnectByLabel } from "@/lib/meta/token-expiry";
import { translator, type AppLocale } from "@/i18n/locale";
import { useState } from "react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useRouter } from "next/navigation";
import { CheckCircle2, Link2, RefreshCw } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetaConnectDialog } from "@/components/meta-connect/meta-connect-dialog";
import type { MetaConnection } from "@/lib/meta/credentials";
import { connectTrustLine } from "@/lib/trust-lines";
import type { FundingMode } from "@/lib/payments/operator-funding";

export function MetaConnectionPanel({
  businessId,
  connection,
  oauthConfigured,
  notice,
  fundingMode = null,
  locale = "en",
}: {
  businessId?: string;
  connection: MetaConnection;
  oauthConfigured: boolean;
  notice?: { kind: "success" | "error"; message: string };
  /** #1292: who holds the ad money decides the trust line; unknown shows none. */
  fundingMode?: FundingMode | null;
  /** #1916, #1438: the panel's language. */
  locale?: AppLocale;
}) {
  const t = translator(locale, "settings");
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  async function disconnect() {
    if (!businessId || disconnecting) return;
    // #1916 (CPO): disconnecting never pauses ads in Meta, so the question says so.
    if (!(await confirm({ title: t("disconnect.title"), description: t("disconnect.body"), confirmLabel: t("disconnect.confirm"), cancelLabel: t("disconnect.cancel"), tone: "danger" }))) return;
    setDisconnecting(true);
    setDisconnectError(null);
    try {
      const response = await fetch("/api/meta/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId }),
      });
      const result = await response.json();
      if (!response.ok || result?.ok !== true) {
        throw new Error(typeof result?.error === "string" ? result.error : t("meta.disconnectFailed"));
      }
      router.refresh();
    } catch (error) {
      setDisconnectError(error instanceof Error ? error.message : t("meta.disconnectFailed"));
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <Card>
      {confirmDialog}
      <CardHeader>
        <CardTitle as="h2" className="flex items-center gap-2">
          <Link2 className="h-5 w-5 text-blue-600" aria-hidden="true" />
          {t("meta.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {notice && <Alert variant={notice.kind === "error" ? "error" : "success"}>{notice.message}</Alert>}
        {disconnectError && <Alert variant="error">{disconnectError}</Alert>}
        {connection.source === "env" && (
          <Alert variant="warning">{t("meta.serverManaged")}</Alert>
        )}
        {connection.source === "oauth" && connection.expired && (
          <Alert variant="warning">{t("meta.expired")}</Alert>
        )}
        {connection.source === "oauth" && !connection.expired && reconnectByLabel(connection.tokenExpiresAt) && (
          <Alert variant="warning">{t("meta.reconnectBy", { date: reconnectByLabel(connection.tokenExpiresAt) ?? "" })}</Alert>
        )}
        {connection.ready && (
          <div className="flex items-start gap-2 text-sm text-emerald-800">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t("meta.connected")}</span>
          </div>
        )}
        {!connection.ready && connection.source !== "env" && (
          <p className="text-sm text-slate-600">{t("meta.intro")}</p>
        )}
        {businessId && fundingMode && <p className="text-sm text-slate-700">{connectTrustLine(fundingMode)}</p>}
        {!businessId && <Alert variant="warning">{t("meta.noBusiness")}</Alert>}
        {businessId && !oauthConfigured && (
          <Alert variant="warning">{t("meta.notConfigured")}</Alert>
        )}
        <div className="flex flex-wrap gap-2">
          {businessId && oauthConfigured && (
            <Button data-product-event="meta.connect" variant={connection.ready ? "outline" : "primary"} disabled={disconnecting} onClick={() => setDialogOpen(true)}>
              {connection.ready || connection.expired ? <RefreshCw className="h-4 w-4" aria-hidden="true" /> : <Link2 className="h-4 w-4" aria-hidden="true" />}
              {t(connection.ready ? "meta.manage" : connection.expired ? "meta.reconnect" : "meta.connect")}
            </Button>
          )}
          {connection.source === "oauth" && (
            <Button variant="danger" disabled={!businessId || disconnecting} onClick={() => void disconnect()}>
              {t(disconnecting ? "meta.disconnecting" : "meta.disconnect")}
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
