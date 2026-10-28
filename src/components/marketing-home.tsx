"use client";

import dynamic from "next/dynamic";
import * as AllIcons from "lucide-react"; // #1850 proof: DO NOT MERGE
import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowRight, Brain, Check, CirclePause, IndianRupee, MapPin, MessageCircle, ShieldCheck } from "lucide-react";
import { MARKETING_FAQS } from "@/lib/seo/jsonLd";
import { IDEAS } from "@/lib/ideas";
import { LEGAL_LINKS } from "@/lib/legal-links";
import styles from "./marketing-home.module.css";

// Digits only, for wa.me; unset renders no support link (#289: the owner supplies the number).
const SUPPORT_WHATSAPP = (process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP ?? "").replace(/\D/g, "");

// Below the first screen: kept out of the initial bundle, with its box reserved so nothing shifts.
const AdbrainCycle = dynamic(() => import("@/components/adbrain-cycle").then((m) => m.AdbrainCycle), {
  ssr: false,
  loading: () => <div className={styles.cyclePlaceholder} aria-hidden="true" />,
});


export function MarketingHome() {
  if (typeof window !== "undefined") (window as unknown as { __iconCount?: number }).__iconCount = Object.keys(AllIcons).length; // #1850 proof

  return (
    <div className={styles.page}>
      <a href="#main-content" className={styles.skip}>Skip to content</a>
      <header className={styles.header}>
        <Link href="/" aria-label="AdBrain home" className={styles.logo}><Brain aria-hidden="true" size={26} /> AdBrain</Link>
        <nav aria-label="Main navigation">
          <Link href="/ideas" className={styles.exampleLink}>Campaign ideas</Link>
          <a href="#cycle" className={styles.exampleLink}>How it works</a>
          <Link href="/login" className={styles.signIn}>Sign in <ArrowRight aria-hidden="true" size={16} /></Link>
        </nav>
      </header>
      <main id="main-content">
        <section className={styles.hero} aria-labelledby="hero-title">
          <div className={styles.heroMedia}>
          <picture>
            <source media="(max-width: 760px)" srcSet="/hero-ads-mobile.webp" />
            <Image src="/hero-ads.webp" alt="AdBrain ads for local businesses, including a family restaurant and a boutique" fill sizes="100vw" loading="eager" fetchPriority="high" className={styles.heroPhoto} />
          </picture>
          </div>
          <div className={styles.heroContent}>
            <h1 id="hero-title" className={styles.heroStatement}>Ads that bring customers to your WhatsApp.</h1>
            <p className={styles.hinglish} lang="hi-Latn">Ad banao, customers paao, seedha WhatsApp par.</p>
            <p className={styles.heroDescription}>Tell AdBrain about your business. It makes 3 Facebook and Instagram ads in about a minute, runs the one you approve within your daily limit, and shows what each chat cost.</p>
            <div className={styles.actions}>
              <Link href="/login" className={styles.primary}>Make my first ad free <ArrowRight aria-hidden="true" size={18} /></Link>
              <a href="#cycle" className={styles.heroSecondary}>See how it works <ArrowDown aria-hidden="true" size={17} /></a>
            </div>
            <p className={styles.heroNote}>Free to try. ₹999 a month after your first month. Your ad money goes to Meta, not to us.</p>
          </div>
          <p className={styles.heroCaption}>Made by AdBrain for example businesses</p>
        </section>

        <section id="cycle" className={styles.cycle} aria-labelledby="cycle-title">
          <h2 id="cycle-title">From your business to WhatsApp chats</h2>
          <p>One loop: you tell us about your business, approve an ad, and see what every chat cost. The next ads learn from it.</p>
          <AdbrainCycle showSteps className={styles.cycleWidget} />
        </section>

        <section id="example" className={styles.example} aria-labelledby="example-title">
          <div className={styles.sectionHeading}>
            <div><h2 id="example-title">Ads AdBrain made for businesses like yours</h2></div>
            <Link href="/ideas" className={styles.textLink}>See all ideas <ArrowRight size={18} aria-hidden="true" /></Link>
          </div>
          <ul className={styles.ideaGrid}>
            {IDEAS.slice(0, 4).map((idea) => (
              <li key={idea.slug}>
                <Link href={`/ideas/${idea.slug}`}>
                  <Image src={idea.ads[0].image} alt={`An AdBrain ad for a ${idea.title.toLowerCase()}: ${idea.ads[0].headline}`} width={720} height={900} sizes="(max-width: 760px) 50vw, 300px" />
                  <span>{idea.industry}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className={styles.exampleFoot}>Made by AdBrain for example businesses, not customers.</p>
        </section>

        <section className={styles.safety} aria-labelledby="safety-title">
          <div>
            <ShieldCheck size={30} aria-hidden="true" />
            <h2 id="safety-title">You approve every rupee.</h2>
            <p>AI does the work. You decide what goes out under your name, who sees it and what you spend.</p>
            {SUPPORT_WHATSAPP && <a className={styles.support} href={`https://wa.me/${SUPPORT_WHATSAPP}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={18} aria-hidden="true" /> Questions? WhatsApp us</a>}
          </div>
          <ul>
            <li><Check aria-hidden="true" /><div><h3>Approve every ad</h3><p>Check the picture, the words and every claim before an ad is used.</p></div></li>
            <li><CirclePause aria-hidden="true" /><div><h3>Your limit, your pause button</h3><p>Campaigns start paused with the daily limit you set. Pause any time; Meta&apos;s own review still applies.</p></div></li>
            <li><IndianRupee aria-hidden="true" /><div><h3>Simple pricing</h3><p>₹999 a month for AdBrain, first month free. You pay Meta for your ads directly, with a limit you set. No auto-debit, stop any time.</p></div></li>
            <li><MapPin aria-hidden="true" /><div><h3>Your own Page, your customers</h3><p>Ads run from your Facebook Page and Instagram, and customers message your WhatsApp directly.</p></div></li>
          </ul>
        </section>

        <section className={styles.faq} aria-labelledby="faq-title">
          <div><h2 id="faq-title">Questions before you start</h2><Link href="/login" className={styles.primary}>Get started <ArrowRight size={18} aria-hidden="true" /></Link></div>
          <div>{MARKETING_FAQS.map((faq) => <details key={faq.question}><summary>{faq.question}</summary><p>{faq.answer}</p></details>)}</div>
        </section>
      </main>
      <footer className={styles.footer}><span>AdBrain</span><nav aria-label="Resources and legal"><Link href="/guides">Guides</Link>{LEGAL_LINKS.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}</nav></footer>
    </div>
  );
}