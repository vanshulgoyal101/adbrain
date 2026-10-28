import { MarketingHome } from "@/components/marketing-home";
import { JsonLd } from "@/components/json-ld";
import { faqSchema } from "@/lib/seo/jsonLd";

// #1376: static, so the CDN serves prospects; the proxy (src/lib/supabase/middleware.ts) redirects signed-in owners.
export default function Home() {
  return (
    <>
      <JsonLd data={faqSchema()} />
      <MarketingHome />
    </>
  );
}
