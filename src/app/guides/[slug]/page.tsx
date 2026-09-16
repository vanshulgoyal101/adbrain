import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LegalPage } from "@/components/legal-page";
import { JsonLd } from "@/components/json-ld";
import { AD_FORMATS } from "@/lib/creative/design";
import { MARKETING_GUIDES, findMarketingGuide } from "@/lib/seo/guides";
import { breadcrumbSchema, webPageSchema } from "@/lib/seo/jsonLd";
import { absoluteUrl, siteConfig } from "@/lib/site";

export const dynamicParams = false;
export function generateStaticParams() {
  return MARKETING_GUIDES.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const guide = findMarketingGuide((await params).slug);
  if (!guide) notFound();
  const path = `/guides/${guide.slug}`;
  return {
    title: guide.title, description: guide.description, alternates: { canonical: path },
    openGraph: { type: "article", title: guide.title, description: guide.description, url: path, modifiedTime: guide.updated },
    twitter: { card: "summary_large_image", title: guide.title, description: guide.description },
  };
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const guide = findMarketingGuide((await params).slug);
  if (!guide) notFound();
  const path = `/guides/${guide.slug}`;
  const related = MARKETING_GUIDES.filter((item) => item.slug !== guide.slug);
  return <>
    <JsonLd data={{
      "@context": "https://schema.org", "@graph": [
        webPageSchema({ path, name: guide.title, description: guide.description }),
        breadcrumbSchema([{ name: "Home", path: "/" }, { name: "Guides", path: "/guides" }, { name: guide.title, path }]),
        {
          "@context": "https://schema.org", "@type": "Article", "@id": `${absoluteUrl(path)}#article`,
          headline: guide.title, description: guide.description, dateModified: guide.updated,
          datePublished: guide.updated, mainEntityOfPage: absoluteUrl(path),
          author: { "@type": "Organization", name: siteConfig.name, url: siteConfig.url },
          publisher: { "@id": `${siteConfig.url}/#organization` },
          image: absoluteUrl("/solar-example.jpg"),
        },
      ],
    }} />
    <LegalPage title={guide.title} updated="16 September 2026">
      <nav aria-label="Breadcrumb" className="text-sm"><Link href="/guides">Guides</Link> / {guide.title}</nav>
      <p className="text-lg">{guide.description}</p>
      <figure className="my-6">
        <Image src="/solar-example.jpg" alt="Ground-mounted solar panels, an example subject for a local-business ad" width={900} height={600} className="aspect-3/2 w-full rounded-lg object-cover" />
        <figcaption className="mt-2 text-sm text-slate-500">Example source photography. Review the finished ad separately from its source image.</figcaption>
      </figure>
      {guide.sections.map((section, index) => <section key={section.title}>
        <h2>{section.title}</h2>
        {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        {guide.slug === "ad-creative-sizes" && index === 0 && <div className="my-6 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="mb-3 text-left font-semibold">AdBrain finished export sizes</caption>
            <thead><tr className="border-b border-slate-300"><th className="p-2">Format</th><th className="p-2">Pixels</th><th className="p-2">Ratio</th></tr></thead>
            <tbody>{Object.entries(AD_FORMATS).map(([format, size]) => <tr key={format} className="border-b border-slate-200">
              <th scope="row" className="p-2 capitalize">{format}</th>
              <td className="whitespace-nowrap p-2">{size.width} x {size.height}</td>
              <td className="p-2">{(size.width / size.height).toFixed(2)}:1</td>
            </tr>)}</tbody>
          </table>
        </div>}
        {section.checklist && <ul>{section.checklist.map((item) => <li key={item}>{item}</li>)}</ul>}
      </section>)}
      <section>
        <h2>Next steps</h2>
        <p><Link href="/login">Open your AdBrain workspace</Link> to create and review a draft.</p>
        <ul>{related.map((item) => <li key={item.slug}><Link href={`/guides/${item.slug}`}>{item.title}</Link></li>)}</ul>
        <p>Placement specifications and advertising policies can change. Check the <a href="https://www.facebook.com/business/ads-guide">Meta Ads Guide</a> and <a href="https://transparency.meta.com/policies/ad-standards/">Meta Advertising Standards</a> before publishing.</p>
      </section>
    </LegalPage>
  </>;
}