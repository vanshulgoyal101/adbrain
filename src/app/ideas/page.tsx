import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { IDEAS } from "@/lib/ideas";
import { IdeasShell } from "./ideas-shell";
import styles from "./ideas.module.css";

const title = "Ad ideas for local businesses";
const description = "Real Facebook and Instagram ads made by AdBrain for a solar installer, clinic, salon, gym, coaching institute, restaurant and more.";

export const metadata: Metadata = {
  title, description, alternates: { canonical: "/ideas" },
  openGraph: { title, description, url: "/ideas", type: "website" },
};

export default function IdeasPage() {
  return (
    <IdeasShell>
      <h1>{title}</h1>
      <p className={styles.lede}>Pick a business like yours to see three ads AdBrain made for it, then make your own from the same idea.</p>
      <p className={styles.note}>Made by AdBrain for example businesses, not customers. Your ads use your own Brand, photos and offers.</p>
      <ul className={styles.grid}>
        {IDEAS.map((idea) => (
          <li key={idea.slug} className={styles.card}>
            <Link href={`/ideas/${idea.slug}`}>
              <Image src={idea.ads[0].image} alt={`An AdBrain ad for a ${idea.title.toLowerCase()}: ${idea.ads[0].headline}`} width={720} height={900} sizes="(max-width: 760px) 50vw, 300px" />
              <h2>{idea.industry}</h2>
              <p>{idea.title}</p>
            </Link>
          </li>
        ))}
      </ul>
    </IdeasShell>
  );
}
