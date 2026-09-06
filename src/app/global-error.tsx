"use client";

import { useEffect } from "react";
import { Brain } from "lucide-react";

/**
 * Last-resort boundary. `error.tsx` cannot catch a failure in the root layout,
 * so without this the user would get Next's raw, unstyled error page. This
 * replaces the whole document, hence its own <html>/<body> and inline styles
 * (the stylesheet may be exactly what failed to load).
 */
export default function GlobalError({
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
    <html lang="en">
      <head><title>Something went wrong - AdBrain</title><link rel="icon" href="/icon.svg?v=brain-1" type="image/svg+xml" /></head>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          padding: "1.5rem",
          textAlign: "center",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          color: "#0f172a",
          background: "#ffffff",
        }}
      >
        <p style={{ margin: 0, fontWeight: 500, color: "#2563eb", display: "flex", alignItems: "center", gap: 8 }}><Brain size={24} aria-hidden="true" />AdBrain</p>
        <h1 style={{ margin: 0, fontSize: "1.25rem" }}>Something went wrong</h1>
        <p style={{ margin: 0, maxWidth: "28rem", color: "#475569" }}>
          We hit an unexpected error and couldn&apos;t load the page. Try again —
          if it keeps happening, come back in a few minutes.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            cursor: "pointer",
            borderRadius: "0.5rem",
            border: "none",
            background: "#2563eb",
            color: "#ffffff",
            padding: "0.5rem 1rem",
            fontSize: "0.875rem",
            fontWeight: 500,
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
