import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { MakeOneLikeThis } from "@/components/make-one-like-this";
import { IDEAS, findIdea } from "@/lib/ideas";
import { IdeasShell } from "../ideas-shell";
import styles from "../ideas.module.css";

export const dynamicParams = false;
export function generateStaticParams() {
  return IDEAS.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const idea = findIdea((await params).slug);
  if (!idea) notFound();
  const title = `Ad ideas for a ${idea.title.toLowerCase()}`;
  const description = `Three Facebook and Instagram ads AdBrain made for a ${idea.title.toLowerCase()}. Make one like it for your business.`;
  return { title, description, alternates: { canonical: `/ideas/${idea.slug}` }, openGraph: { title, description, url: `/ideas/${idea.slug}`, images: [idea.ads[0].image] } };
}

export default async function IdeaPage({ params }: { params: Promise<{ slug: string }> }) {
  const idea = findIdea((await params).slug);
  if (!idea) notFound();
  return (
    <IdeasShell>
      <Link href="/ideas" className={styles.back}><ArrowLeft size={16} aria-hidden="true" /> All ideas</Link>
      <h1>Ad ideas for a {idea.title.toLowerCase()}</h1>
      <p className={styles.lede}>The goal AdBrain was given: &ldquo;{idea.goal}&rdquo;</p>
      <p className={styles.note}>Made by AdBrain for an example business ({idea.brand.name}), not a customer. Yours will use your own Brand, photos and offers.</p>
      <ul className={styles.ads}>
        {idea.ads.map((ad, index) => (
          <li key={ad.image} className={styles.ad}>
            <Image src={ad.image} alt={`Ad ${index + 1}: ${ad.headline}`} width={720} height={900} sizes="(max-width: 900px) 100vw, 400px" priority={index === 0} />
            <p className={styles.angle}>{ad.angle}</p>
            <h2>{ad.headline}</h2>
            <p>{ad.primaryText}</p>
          </li>
        ))}
      </ul>
      <MakeOneLikeThis goal={idea.goal} className={styles.primary} />
    </IdeasShell>
  );
}
