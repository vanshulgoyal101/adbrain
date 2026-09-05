"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const router = useRouter();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    // Also clear the offline dev cookie (httpOnly — must be cleared server-side).
    if (process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === "true") {
      window.location.href = "/auth/dev-logout";
      return;
    }
    router.push("/login");
    router.refresh();
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={signOut}
      aria-label="Sign out"
      title="Sign out"
      className="w-auto justify-start px-2 text-slate-600 md:w-full md:px-3"
    >
      <LogOut className="h-4 w-4" />
      <span className="hidden md:inline">Sign out</span>
    </Button>
  );
}
