import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Brain, MessageCircle } from "lucide-react";
import { LEGAL_LINKS } from "@/lib/legal-links";
import { SEGMENTS, segmentBySlug, segmentWhatsAppHref, type Segment } from "@/lib/segments";
import styles from "./segment.module.css";

// #1565: static per segment, no auth or database read, so the leave-behind link opens fast on a phone.
// #1944: naming Solaride publicly waits on the CEO (#1937); flip this once they say yes.
const SHOW_SOLARIDE_PROOF = false;
export const dynamicParams = false;
export function generateStaticParams() {
  return SEGMENTS.map(({ slug }) => ({ segment: slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ segment: string }> }): Promise<Metadata> {
  const segment = segmentBySlug((await params).segment);
  if (!segment) notFound();
  const title = `AdBrain for ${segment.trade}`;
  const path = `/for/${segment.slug}`;
  return {
    title, description: segment.description, alternates: { canonical: path },
    openGraph: { type: "website", title, description: segment.description, url: path },
    twitter: { card: "summary_large_image", title, description: segment.description },
  };
}

function Chat({ segment }: { segment: Segment }) {
  return (
    <figure className={styles.phone} aria-label={`What a customer sends: ${segment.ask}`}>
      <figcaption className={styles.chatTop}>
        <span aria-hidden="true" className={styles.avatar}>{segment.chatName.split(" ")[1]?.[0]?.toUpperCase()}</span>
        {segment.chatName}
      </figcaption>
      <div className={styles.chat}>
        <p className={styles.in}>{segment.welcome}</p>
        <p className={styles.out}>{segment.ask}</p>
      </div>
    </figure>
  );
}

// #1632: with a WhatsApp number, that is the one solid button and self sign-up is a quiet text link.
function Actions({ whatsapp }: { whatsapp: string | null }) {
  return (
    <div className={styles.actions}>
      {whatsapp ? (
        <>
          <a href={whatsapp} className={styles.primary} target="_blank" rel="noopener noreferrer"><MessageCircle aria-hidden="true" size={20} /> Message us on WhatsApp</a>
          <Link href="/login" className={styles.textLink}>Or start on your own</Link>
        </>
      ) : (
        <Link href="/login" className={styles.primary}>Start my free campaign</Link>
      )}
    </div>
  );
}

export default async function SegmentPage({ params }: { params: Promise<{ segment: string }> }) {
  const segment = segmentBySlug((await params).segment);
  if (!segment) notFound();
  const whatsapp = segmentWhatsAppHref(segment);
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" aria-label="AdBrain home" className={styles.logo}><Brain aria-hidden="true" size={24} /> AdBrain</Link>
        <Link href="/login" className={styles.signIn}>Sign in</Link>
      </header>
      <main>
        <section className={styles.hero} aria-labelledby="segment-title">
          <div className={styles.heroText}>
            <h1 id="segment-title">{segment.headline}</h1>
            <p className={styles.lede}>{segment.description}</p>
            <p className={styles.hinglish} lang="hi-Latn">{segment.hinglish}</p>
            <Actions whatsapp={whatsapp} />
          </div>
          <Chat segment={segment} />
        </section>

        {SHOW_SOLARIDE_PROOF && segment.proof ? (
          <section className={styles.block} aria-labelledby="proof-title">
            <h2 id="proof-title">{segment.proof.heading}</h2>
            <p className={styles.proof}>{segment.proof.body}</p>
            <p className={styles.hinglish} lang="hi-Latn">{segment.proof.hinglish}</p>
            <p className={styles.note}>{segment.proof.smallPrint}</p>
          </section>
        ) : segment.firstThree ? (
          <section className={styles.block} aria-label="Early pilots">
            <p className={styles.proof}>{segment.firstThree}</p>
          </section>
        ) : null}

        {segment.tiles && (
          <section className={styles.block} aria-labelledby="samples-title">
            <h2 id="samples-title">Ads AdBrain could make for you</h2>
            <p className={styles.note}>Examples AdBrain made. Yours use your own name, area and offer.</p>
            <ul className={styles.tiles}>
              {segment.tiles.map((tile) => (
                <li key={tile.src}>
                  <figure>
                    <div className={styles.tileFrame}>
                      <Image src={tile.src} alt={tile.alt} width={720} height={900} sizes="(min-width: 860px) 300px, 70vw" />
                      <span className={styles.sample}>Sample</span>
                    </div>
                    <figcaption>{tile.caption}</figcaption>
                  </figure>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className={styles.block} aria-labelledby="offer-title">
          <h2 id="offer-title">Your first campaign, set up with you for free</h2>
          <dl className={styles.costs}>
            <div><dt>Setup</dt><dd><strong>Free</strong><span>We make your ads and set up your first campaign with you, in about 20 minutes.</span></dd></div>
            <div><dt>Ads</dt><dd><strong>You pay Meta directly</strong><span>From your own ad account. We suggest ₹300 a day for 7 days (₹2,100 plus Meta&apos;s GST). Stop any time.</span></dd></div>
            <div><dt>AdBrain</dt><dd><strong>₹999 a month</strong><span>First month free. No auto-debit, no lock-in.</span></dd></div>
          </dl>
        </section>

        <section className={styles.block} aria-labelledby="steps-title">
          <h2 id="steps-title">How it starts</h2>
          <ol className={styles.steps}>
            <li>Tell AdBrain your business, where you work and one real offer.</li>
            <li>{segment.tiles ? "AdBrain makes 3 ads, like the samples above. You pick the ones you like." : <>AdBrain makes 3 ads. For {segment.trade} they can lead with: {segment.angles.join("; ")}. You pick the ones you like.</>}</li>
            <li>You set the daily amount and go live. Meta checks your ads first, usually within a few hours and up to a day.</li>
          </ol>
        </section>

        <section className={styles.block} aria-labelledby="trust-title">
          <h2 id="trust-title">You stay in control</h2>
          <ul className={styles.list}>
            <li>Your Page, your ad account, your card. AdBrain never holds your ad money.</li>
            <li>It stops at the limit you set. Pause any time from your phone.</li>
            <li>Customers message you on WhatsApp themselves. No forms, no shared leads.</li>
            <li>Nothing goes live until you say so.</li>
          </ul>
          <p className={styles.note}>We can&apos;t promise a number of customers. Your first 7 days show what your ads bring.</p>
        </section>

        {whatsapp && (
          <section className={styles.block} aria-labelledby="end-title">
            <h2 id="end-title">Want us to set up your first campaign?</h2>
            <Actions whatsapp={whatsapp} />
          </section>
        )}
      </main>
      <footer className={styles.footer}>
        <span>AdBrain</span>
        <nav aria-label="Legal">{LEGAL_LINKS.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}</nav>
      </footer>
    </div>
  );
}
