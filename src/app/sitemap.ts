import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";

/**
 * Only public, indexable routes belong here. The app itself (dashboard, brand,
 * studio, campaigns) is auth-gated and intentionally excluded.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    {
      url: absoluteUrl("/"),
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: absoluteUrl("/privacy"),
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: absoluteUrl("/terms"),
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
