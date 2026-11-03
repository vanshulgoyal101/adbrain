"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

/** #1438: the shell passes its words; English by default. */
export function SignOutButton({ label = "Sign out", failed = "Could not sign out. Please try again.", lang }: { label?: string; failed?: string; lang?: string }) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const result = await supabase.auth.signOut();
      if (result.error) throw result.error;
      if (process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === "true") {
        const response = await fetch("/auth/dev-logout");
        if (!response.ok) throw new Error("Dev session could not be cleared.");
      }
      router.push("/login");
      router.refresh();
    } catch {
      setError(failed);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <div>
    <Button
      variant="ghost"
      size="sm"
      onClick={signOut}
      disabled={busy}
      aria-busy={busy}
      aria-label={label}
      title={label}
      lang={lang}
      className="min-h-11 w-full justify-start gap-3 px-3 text-slate-600"
    >
      <LogOut className="h-4 w-4" />
      <span>{label}</span>
    </Button>
    {error && <p role="alert" lang={lang} className="mt-1 max-w-48 text-xs text-red-700">{error}</p>}
    </div>
  );
}
