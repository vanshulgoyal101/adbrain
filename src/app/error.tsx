"use client";

import { useEffect, useRef } from "react";
import { Brain } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    console.error(error);
    headingRef.current?.focus();
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="flex items-center gap-2 text-sm font-medium text-blue-600"><Brain size={24} aria-hidden="true" />AdBrain</p>
      <h1 ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-slate-900">
        Something went wrong
      </h1>
      <p className="max-w-md text-sm text-slate-600">
        An unexpected error occurred. You can try again — if it keeps happening,
        refresh the page.
      </p>
      <Button onClick={retry}>Try again</Button>
      <a href="/login" className="text-sm font-medium text-blue-700 underline">Sign in</a>
    </div>
  );
}
