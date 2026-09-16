import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { LegalPage } from "@/components/legal-page";
import { JsonLd } from "@/components/json-ld";
import { MARKETING_GUIDES } from "@/lib/seo/guides";
import { contentPageGraph } from "@/lib/seo/jsonLd";

const title = "Ad Creative and Campaign Guides";
const description = "Practical AdBrain references for image sizes, creative review, Meta account readiness and responsible campaign budgets.";

export const metadata: Metadata = {
  title, description, alternates: { canonical: "/guides" },
  openGraph: { title, description, url: "/guides", type: "website" },
  twitter: { card: "summary_large_image", title, description },
};

export default function GuidesPage() {
  return <>
    <JsonLd data={contentPageGraph({ path: "/guides", name: title, description })} />
    <LegalPage title={title} updated="16 September 2026">
      <p>From the first creative brief to a paused campaign ready for review.</p>
      <ul className="!list-none !pl-0 divide-y divide-slate-200">
        {MARKETING_GUIDES.map((guide) => <li key={guide.slug} className="py-6">
          <h2 className="!mt-0"><Link href={`/guides/${guide.slug}`}>{guide.title}</Link></h2>
          <p>{guide.description}</p>
          <Link href={`/guides/${guide.slug}`} className="mt-3 inline-flex items-center gap-2 text-sm">
            Read guide <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </li>)}
      </ul>
    </LegalPage>
  </>;
}