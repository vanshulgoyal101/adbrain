import { serializeJsonLd, type JsonLdObject } from "@/lib/seo/jsonLd";

/**
 * Renders server-built schema using an HTML-safe JSON serialization.
 */
export function JsonLd({
  data,
}: {
  data: JsonLdObject | { "@context": string; "@graph": JsonLdObject[] };
}) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
