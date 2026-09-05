"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowRight, Brain, Check, CirclePause, MapPin, ShieldCheck } from "lucide-react";
import { MARKETING_FAQS } from "@/lib/seo/jsonLd";
import { LEGAL_LINKS } from "@/lib/legal-links";
import styles from "./marketing-home.module.css";

const EXAMPLES = [
  {
    angle: "Start a conversation",
    headline: "A sunny day. A new possibility.",
    copy: "Thinking about solar for your home? Daylight Solar helps Jaipur homeowners explore their options. Book a consultation and start with your questions.",
    cta: "Book a consultation",
  },
  {
    angle: "Answer a question",
    headline: "Is your home ready for solar?",
    copy: "Every home is different. Talk to Daylight Solar about your space, energy needs, and next steps in Jaipur. Get a clearer picture before you decide.",
    cta: "Explore your options",
  },
];

export function MarketingHome() {
  const [selected, setSelected] = useState(0);
  const example = EXAMPLES[selected];

  return (
    <div className={styles.page}>
      <a href="#main-content" className={styles.skip}>Skip to content</a>
      <header className={styles.header}>
        <Link href="/" aria-label="AdBrain home" className={styles.logo}><Brain aria-hidden="true" size={26} /> AdBrain</Link>
        <nav aria-label="Main navigation">
          <a href="#example" className={styles.exampleLink}>The example</a>
          <Link href="/login" className={styles.signIn}>Sign in <ArrowRight aria-hidden="true" size={16} /></Link>
        </nav>
      </header>
      <main id="main-content">
        <section className={styles.hero} aria-labelledby="hero-title">
          <Image src="/solar-example.jpg" alt="Solar panels under an open sky" fill sizes="100vw" preload className={styles.heroPhoto} />
          <div className={styles.heroContent}>
            <p className={styles.eyebrow}>AI AD CREATIVE FOR LOCAL BUSINESSES</p>
            <h1 id="hero-title">AdBrain</h1>
            <p className={styles.heroStatement}>Your business.<br />Your next great ad.</p>
            <p className={styles.heroDescription}>Turn what makes your business different into images, headlines, and copy. Review the work. Choose what goes live.</p>
            <div className={styles.actions}>
              <Link href="/login" className={styles.primary}>Create your first ad <ArrowRight aria-hidden="true" size={18} /></Link>
              <a href="#example" className={styles.heroSecondary}>Explore an example <ArrowDown aria-hidden="true" size={17} /></a>
            </div>
          </div>
          <p className={styles.heroCaption}>SOLAR / ILLUSTRATIVE EXAMPLE</p>
        </section>

        <section id="example" className={styles.example} aria-labelledby="example-title">
          <div className={styles.sectionHeading}>
            <div><p className={styles.eyebrow}>01 / FROM BUSINESS TO BRIEF</p><h2 id="example-title">One brand. Two ways in.</h2></div>
            <p>Fictional brand, sample copy, stock photography.<br />Not a customer campaign or a live AI generation.</p>
          </div>
          <div className={styles.exampleGrid}>
            <div className={styles.brief}>
              <p className={styles.label}>BRAND BRAIN / EXAMPLE</p>
              <h3>Daylight Solar</h3>
              <p className={styles.location}><MapPin size={15} aria-hidden="true" /> Jaipur, India</p>
              <dl className={styles.brandDetails}>
                <div><dt>Business</dt><dd>Home solar consultations</dd></div>
                <div><dt>Audience</dt><dd>Homeowners exploring solar</dd></div>
                <div><dt>Voice</dt><dd>Clear, friendly, no pressure</dd></div>
                <div><dt>Offer</dt><dd>A conversation about your options</dd></div>
              </dl>
              <div className={styles.goal}><span className={styles.label}>THE GOAL</span><p>&quot;Help homeowners in Jaipur take their first step towards solar.&quot;</p></div>
              <fieldset className={styles.angles}>
                <legend>Creative angle</legend>
                {EXAMPLES.map((item, index) => (
                  <label key={item.angle} className={selected === index ? styles.selectedAngle : undefined}>
                    <input type="radio" name="creative-angle" value={index} checked={selected === index} onChange={() => setSelected(index)} />
                    {item.angle}
                  </label>
                ))}
              </fieldset>
            </div>
            <article className={styles.ad} aria-label="Sample ad">
              <div className={styles.adTop}><strong>Daylight Solar</strong><span>Sample creative</span></div>
              <div className={styles.poster}>
                <div className={styles.posterCopy}><span>DAYLIGHT SOLAR</span><h3>{example.headline}</h3><p>Home solar consultations / Jaipur</p></div>
                <Image src="/solar-example.jpg" alt="Solar panels used as the illustrative ad photograph" width={1800} height={1198} sizes="(max-width: 760px) 100vw, 650px" className={styles.adPhoto} />
              </div>
              <div className={styles.adCopy} aria-live="polite" aria-atomic="true"><p>{example.copy}</p><div><span>Suggested call to action</span><strong>{example.cta} <ArrowRight aria-hidden="true" size={16} /></strong></div></div>
            </article>
          </div>
          <div className={styles.exampleFoot}><span>Illustration only. Your creative depends on your brand, brief, and review.</span><a href="https://unsplash.com/photos/2gDwlIim3Uw" target="_blank" rel="noopener noreferrer">Photo: American Public Power Association / Unsplash</a></div>
        </section>

        <section className={styles.workflow} aria-labelledby="workflow-title">
          <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>02 / MAKE IT YOURS</p><h2 id="workflow-title">A workflow, not a blank prompt.</h2></div><Link href="/login" className={styles.textLink}>Start with your brand <ArrowRight size={18} aria-hidden="true" /></Link></div>
          <ol className={styles.steps}>
            <li><span>01</span><h3>Bring your business</h3><p>Save your voice, offers, service areas, and brand assets. Import a starting point from your website.</p></li>
            <li><span>02</span><h3>Make the creative</h3><p>Set a goal, answer the assistant&apos;s questions, and generate ad variants. Keep the ones that fit.</p></li>
            <li><span>03</span><h3>Review, then launch</h3><p>Export your approved work or connect Meta, choose your audience and budget, and create a paused campaign.</p></li>
          </ol>
        </section>

        <section className={styles.safety} aria-labelledby="safety-title">
          <div><ShieldCheck size={30} aria-hidden="true" /><p className={styles.eyebrow}>03 / YOU MAKE THE CALL</p><h2 id="safety-title">Creative freedom.<br />A deliberate launch.</h2><p>Generating an ad doesn&apos;t start a campaign. Creating a campaign doesn&apos;t activate it.</p></div>
          <ul>
            <li><Check aria-hidden="true" /><div><h3>Approve the creative</h3><p>Check the image, claims, and copy before using an ad.</p></div></li>
            <li><MapPin aria-hidden="true" /><div><h3>Review the audience and budget</h3><p>Choose the locations, daily budget, and lead form before creating a campaign.</p></div></li>
            <li><CirclePause aria-hidden="true" /><div><h3>Created paused</h3><p>New campaigns start paused. Activation is a separate decision; Meta eligibility and review still apply.</p></div></li>
          </ul>
        </section>

        <section className={styles.faq} aria-labelledby="faq-title">
          <div><p className={styles.eyebrow}>BEFORE YOU START</p><h2 id="faq-title">Good questions.</h2><Link href="/login" className={styles.primary}>Get started <ArrowRight size={18} aria-hidden="true" /></Link></div>
          <div>{MARKETING_FAQS.map((faq) => <details key={faq.question}><summary>{faq.question}</summary><p>{faq.answer}</p></details>)}</div>
        </section>
      </main>
      <footer className={styles.footer}><span>AdBrain / AI ad creative for local businesses</span><nav aria-label="Legal">{LEGAL_LINKS.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}</nav></footer>
    </div>
  );
}