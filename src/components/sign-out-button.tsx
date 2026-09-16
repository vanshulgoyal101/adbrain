"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
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
      setError("Could not sign out. Please try again.");
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
      aria-label="Sign out"
      title="Sign out"
      className="w-auto justify-start px-2 text-slate-600 md:w-full md:px-3"
    >
      <LogOut className="h-4 w-4" />
      <span className="hidden md:inline">Sign out</span>
    </Button>
    {error && <p role="alert" className="mt-1 max-w-48 text-xs text-red-700">{error}</p>}
    </div>
  );
}
