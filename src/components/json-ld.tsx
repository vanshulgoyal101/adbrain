import type { JsonLdObject } from "@/lib/seo/jsonLd";

/**
 * Renders a JSON-LD structured-data block. `data` is trusted, server-built
 * schema (never user input), so dangerouslySetInnerHTML is safe here.
 */
export function JsonLd({
  data,
}: {
  data: JsonLdObject | { "@context": string; "@graph": JsonLdObject[] };
}) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
