import type { NextConfig } from "next";
import { getSecurityHeaders } from "./src/lib/security/headers";
import { isRazorpayTestEnabled } from "./src/lib/payments/razorpay-test";
import { isProductionPaymentConfigured } from "./src/lib/payments/production-config";

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
  // #1346: Vercel's immutable static assets reused a CSS chunk name (…/immutable/chunks/0topcl4nf4k_5.css)
  // after #1323 changed its content, so production kept serving the old, year-cached file. Opt out:
  // assets go back to per-deployment URLs (?dpl=), so every deploy ships its own CSS/JS.
  supportsImmutableAssets: false,
  outputFileTracingIncludes: {
    "/api/creatives/**/*": [
      "./node_modules/sharp/**/*",
      "./node_modules/@img/sharp-linux-x64/**/*",
      "./node_modules/@img/sharp-libvips-linux-x64/**/*",
      "./src/lib/creative/fonts/**/*",
    ],
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
    return [
      { source: "/:path*", headers: getSecurityHeaders(supabaseUrl, isRazorpayTestEnabled(), isProductionPaymentConfigured()) },
      { source: "/(api|auth|connect)/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
};

export default nextConfig;
