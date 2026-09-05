import type { NextConfig } from "next";
import { getSecurityHeaders } from "./src/lib/security/headers";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
let supabaseHost: string | undefined;
try {
  if (supabaseUrl) supabaseHost = new URL(supabaseUrl).hostname;
} catch {
  supabaseHost = undefined;
}

const nextConfig: NextConfig = {
  // This workspace contains several sibling package-lock files. Pinning the
  // root keeps Turbopack from treating the parent workspace as this app.
  turbopack: {
    root: __dirname,
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "image.pollinations.ai" },
      ...(supabaseHost
        ? [{ protocol: "https" as const, hostname: supabaseHost }]
        : []),
    ],
  },
  experimental: {
    // Every page in the app renders live, per-user data (campaigns, leads,
    // spend). Disable the client Router Cache for dynamic routes so navigating
    // back to a tab always refetches instead of showing a stale snapshot.
    staleTimes: {
      dynamic: 0,
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: getSecurityHeaders(supabaseUrl) }];
  },
};

export default nextConfig;
