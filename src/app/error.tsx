"use client";

import { useEffect } from "react";
import { Brain } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="flex items-center gap-2 text-sm font-medium text-blue-600"><Brain size={24} aria-hidden="true" />AdBrain</p>
      <h1 className="text-xl font-semibold text-slate-900">
        Something went wrong
      </h1>
      <p className="max-w-md text-sm text-slate-600">
        An unexpected error occurred. You can try again — if it keeps happening,
        refresh the page.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
