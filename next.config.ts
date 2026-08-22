import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
let supabaseHost: string | undefined;
try {
  if (supabaseUrl) supabaseHost = new URL(supabaseUrl).hostname;
} catch {
  supabaseHost = undefined;
}

const nextConfig: NextConfig = {
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
};

export default nextConfig;
