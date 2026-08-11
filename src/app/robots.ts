import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site";

/** Allow the marketing pages; keep the app and API surfaces out of the index. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/auth/", "/dashboard", "/brand", "/studio", "/campaigns"],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
    host: absoluteUrl("/"),
  };
}
