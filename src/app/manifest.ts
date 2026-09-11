import type { MetadataRoute } from "next";
import { siteConfig } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  const asset = (path: string) => `${path}?v=${siteConfig.assetVersion}`;
  return {
    name: `${siteConfig.name} — ${siteConfig.tagline}`,
    short_name: siteConfig.name,
    description: siteConfig.shortDescription,
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#2563eb",
    icons: [
      // Chrome's install prompt rejects SVG — PNG at 192/512 is required.
      { src: asset("/icon-192.png"), sizes: "192x192", type: "image/png", purpose: "any" },
      { src: asset("/icon-512.png"), sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: asset("/maskable-512.png"),
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      { src: asset("/icon.svg"), sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
