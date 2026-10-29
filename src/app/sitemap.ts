import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";
import { MARKETING_GUIDES } from "@/lib/seo/guides";
import { IDEAS } from "@/lib/ideas";
import { SEGMENTS } from "@/lib/segments";

/**
 * Only public, indexable routes belong here. The app itself (dashboard, brand,
 * studio, campaigns) is auth-gated and intentionally excluded.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: absoluteUrl("/"),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: absoluteUrl("/privacy"),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: absoluteUrl("/data-deletion"),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: absoluteUrl("/terms"),
      changeFrequency: "yearly",
      priority: 0.3,
    },
    { url: absoluteUrl("/guides"), changeFrequency: "monthly", priority: 0.7 },
    { url: absoluteUrl("/ideas"), changeFrequency: "monthly", priority: 0.8 },
    ...SEGMENTS.map((segment) => ({ url: absoluteUrl(`/for/${segment.slug}`), changeFrequency: "monthly" as const, priority: 0.6 })),
    ...IDEAS.map((idea) => ({ url: absoluteUrl(`/ideas/${idea.slug}`), changeFrequency: "monthly" as const, priority: 0.6 })),
    ...MARKETING_GUIDES.map((guide) => ({
      url: absoluteUrl(`/guides/${guide.slug}`), lastModified: guide.updated,
    })),
  ];
}
