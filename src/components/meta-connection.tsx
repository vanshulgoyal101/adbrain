"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Link2, Link2Off, RefreshCw } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MetaConnection } from "@/lib/meta/credentials";

interface AdAccount {
  id: string;
  accountId: string;
  name: string;
  currency?: string;
  disabled: boolean;
}
interface Page {
  id: string;
  name: string;
}

const connectBtn =
  "inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white transition-colors hover:bg-blue-700";

export function MetaConnectionPanel({
  connection,
  oauthConfigured,
  notice,
}: {
  connection: MetaConnection;
  oauthConfigured: boolean;
  notice?: { kind: "success" | "error"; message: string };
}) {
  const router = useRouter();
  const autoLoad = connection.source === "oauth" && !connection.expired;
  const [adAccounts, setAdAccounts] = useState<AdAccount[]>([]);
  const [pages, setPages] = useState<Page[]>([]);
  const [accountId, setAccountId] = useState(connection.adAccountId ?? "");
  const [pageId, setPageId] = useState(connection.pageId ?? "");
  const [loading, setLoading] = useState(autoLoad);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showSelector =
    connection.source === "oauth" && (connection.pending || connection.expired === false);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/meta/accounts");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not load accounts.");
      setAdAccounts(data.adAccounts ?? []);
      setPages(data.pages ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!autoLoad) return;
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/meta/accounts");
        const data = await res.json();
        if (!active) return;
        if (!res.ok) throw new Error(data.error ?? "Could not load accounts.");
        setAdAccounts(data.adAccounts ?? []);
        setPages(data.pages ?? []);
      } catch (err) {
        if (active) setError((err as Error).message);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [autoLoad]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/meta/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adAccountId: accountId, pageId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save.");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    if (!confirm("Disconnect this Meta account?")) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/meta/disconnect", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not disconnect.");
      }
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-5 w-5 text-blue-600" />
          Meta (Facebook &amp; Instagram)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {notice && (
          <Alert variant={notice.kind === "error" ? "error" : "success"}>
            {notice.message}
          </Alert>
        )}
        {error && <Alert variant="error">{error}</Alert>}

        {connection.source === "env" && (
          <p className="text-sm text-slate-600">
            Connected using server credentials (single-tenant). Ad account{" "}
            <code className="rounded bg-slate-100 px-1">
              {connection.adAccountId}
            </code>
            .
          </p>
        )}

        {connection.source === "none" && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Connect your Meta account to launch and manage lead campaigns from
              AdBrain. You&apos;ll pick which ad account and page to use.
            </p>
            {oauthConfigured ? (
              <a href="/api/meta/oauth/start" className={connectBtn}>
                <Link2 className="h-4 w-4" />
                Connect with Facebook
              </a>
            ) : (
              <Alert variant="warning">
                Facebook Login isn&apos;t configured on this server yet
                (`META_APP_ID` / `META_APP_SECRET`).
              </Alert>
            )}
          </div>
        )}

        {connection.source === "oauth" && connection.expired && (
          <div className="space-y-3">
            <Alert variant="warning">
              Your Meta login has expired. Reconnect to keep managing campaigns.
            </Alert>
            <a href="/api/meta/oauth/start" className={connectBtn}>
              <RefreshCw className="h-4 w-4" />
              Reconnect
            </a>
          </div>
        )}

        {connection.source === "oauth" && connection.ready && (
          <div className="flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            Connected — ad account{" "}
            <code className="rounded bg-slate-100 px-1">
              {connection.adAccountId}
            </code>
            , page{" "}
            <code className="rounded bg-slate-100 px-1">
              {connection.pageId}
            </code>
            .
          </div>
        )}

        {showSelector && !connection.expired && (
          <div className="space-y-3">
            {connection.pending && (
              <p className="text-sm text-slate-600">
                Almost there — choose the ad account and page to use.
              </p>
            )}
            {loading ? (
              <p className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading your
                accounts…
              </p>
            ) : (
              <>
                <label className="block text-sm font-medium text-slate-700">
                  Ad account
                  <select
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Select an ad account…</option>
                    {adAccounts.map((a) => (
                      <option key={a.id} value={a.id} disabled={a.disabled}>
                        {a.name} ({a.id}
                        {a.currency ? `, ${a.currency}` : ""})
                        {a.disabled ? " — unavailable" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Facebook page
                  <select
                    value={pageId}
                    onChange={(e) => setPageId(e.target.value)}
                    className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  >
                    <option value="">Select a page…</option>
                    {pages.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.id})
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={save}
                    disabled={saving || !accountId || !pageId}
                  >
                    {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                    Save connection
                  </Button>
                  <Button variant="ghost" onClick={loadAccounts} disabled={loading}>
                    <RefreshCw className="h-4 w-4" />
                    Refresh
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {connection.source === "oauth" && (
          <div className="border-t border-slate-100 pt-3">
            <Button variant="danger" size="sm" onClick={disconnect} disabled={saving}>
              <Link2Off className="h-4 w-4" />
              Disconnect
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
