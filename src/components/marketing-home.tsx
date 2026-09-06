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
    industry: "Food & drink",
    brand: "Sunday Coffee",
    location: "Bengaluru, India",
    business: "Neighbourhood coffee shop",
    audience: "Neighbours looking for their next coffee spot",
    voice: "Warm, unhurried, inviting",
    offer: "Coffee and a place to pause",
    goal: "Give people nearby a reason to stop in this weekend.",
    headline: "Make room for a slower morning.",
    copy: "Your weekend doesn't need another plan. Just a good coffee and a seat at Sunday Coffee in Bengaluru. Drop by, settle in, and make a little time for yourself.",
    cta: "Plan your visit",
    image: "/campaign-coffee.jpg",
    alt: "Coffee served at a cafe, an illustrative ad photograph",
    photoUrl: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085",
    tone: "coffee",
  },
  {
    industry: "Fitness",
    brand: "Form Studio",
    location: "Pune, India",
    business: "Small-group fitness classes",
    audience: "People looking for a welcoming first class",
    voice: "Encouraging, approachable, no pressure",
    offer: "A conversation about the right class for you",
    goal: "Help first-time visitors feel comfortable asking about a class.",
    headline: "Your first class starts with a hello.",
    copy: "Find your starting point at Form Studio in Pune. Tell us what you're looking for, ask your questions, and explore our small-group classes before you decide.",
    cta: "Ask about a class",
    image: "/campaign-fitness.jpg",
    alt: "Equipment in a fitness studio, an illustrative ad photograph",
    photoUrl: "https://images.unsplash.com/photo-1571902943202-507ec2618e8f",
    tone: "fitness",
  },
  {
    industry: "Home services",
    brand: "Studio Habitat",
    location: "Hyderabad, India",
    business: "Residential interior design",
    audience: "Homeowners planning a room refresh",
    voice: "Thoughtful, practical, personal",
    offer: "An interior design consultation",
    goal: "Start conversations with homeowners thinking about a change.",
    headline: "A space that feels more like you.",
    copy: "A new chapter for your living room? Talk through your ideas with Studio Habitat in Hyderabad. Start with the way you live, the space you have, and what you'd like to change.",
    cta: "Book a consultation",
    image: "/campaign-interiors.jpg",
    alt: "A furnished living room, an illustrative ad photograph",
    photoUrl: "https://images.unsplash.com/photo-1600210492486-724fe5c67fb0",
    tone: "interiors",
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
          <a href="#example" className={styles.exampleLink}>Campaign ideas</a>
          <a href="#workflow" className={styles.exampleLink}>From idea to enquiry</a>
          <Link href="/login" className={styles.signIn}>Sign in <ArrowRight aria-hidden="true" size={16} /></Link>
        </nav>
      </header>
      <main id="main-content">
        <section className={styles.hero} aria-labelledby="hero-title">
          <picture>
            <source media="(max-width: 760px)" srcSet="/campaign-preview-mobile.webp" />
            <Image src="/campaign-preview.webp" alt="Illustrative campaign creative for a coffee shop, fitness studio, and interior designer" fill sizes="100vw" loading="eager" fetchPriority="high" className={styles.heroPhoto} />
          </picture>
          <div className={styles.heroContent}>
            <p className={styles.eyebrow}>MARKETING FOR THE BUSINESS YOU&apos;RE BUILDING</p>
            <h1 id="hero-title">AdBrain</h1>
            <p className={styles.heroStatement}>Reach the right customers.</p>
            <p className={styles.heroDescription}>Bring your business, your offer, and your ambition. Create on-brand marketing, build Facebook and Instagram campaigns, and turn enquiries into conversations.</p>
            <div className={styles.actions}>
              <Link href="/login" className={styles.primary}>Create your first campaign <ArrowRight aria-hidden="true" size={18} /></Link>
              <a href="#example" className={styles.heroSecondary}>Explore campaign ideas <ArrowDown aria-hidden="true" size={17} /></a>
            </div>
            <p className={styles.heroNote}>Your brand. Your budget. Your approval before launch.</p>
          </div>
          <p className={styles.heroCaption}>CAMPAIGN IDEAS / ILLUSTRATIVE EXAMPLES</p>
        </section>

        <section id="example" className={styles.example} aria-labelledby="example-title">
          <div className={styles.sectionHeading}>
            <div><p className={styles.eyebrow}>01 / DIFFERENT BUSINESSES. REAL-WORLD GOALS.</p><h2 id="example-title">What would you like your next customer to do?</h2></div>
            <p>Fictional brands, sample copy, stock photography.<br />Not a customer campaign or a live AI generation.</p>
          </div>
          <fieldset className={styles.industries}>
            <legend>Campaign inspiration</legend>
            {EXAMPLES.map((item, index) => (
              <label key={item.industry} className={selected === index ? styles.selectedIndustry : undefined}>
                <input type="radio" name="campaign-industry" value={index} checked={selected === index} onChange={() => setSelected(index)} />
                {item.industry}
              </label>
            ))}
          </fieldset>
          <div className={styles.exampleGrid}>
            <div className={styles.brief}>
              <p className={styles.label}>BRAND BRAIN / EXAMPLE</p>
              <h3>{example.brand}</h3>
              <p className={styles.location}><MapPin size={15} aria-hidden="true" /> {example.location}</p>
              <dl className={styles.brandDetails}>
                <div><dt>Business</dt><dd>{example.business}</dd></div>
                <div><dt>Audience</dt><dd>{example.audience}</dd></div>
                <div><dt>Voice</dt><dd>{example.voice}</dd></div>
                <div><dt>Offer</dt><dd>{example.offer}</dd></div>
              </dl>
              <div className={styles.goal}><span className={styles.label}>THE CUSTOMER GOAL</span><p>&quot;{example.goal}&quot;</p></div>
            </div>
            <article className={styles.ad} aria-label="Sample ad" data-tone={example.tone}>
              <div className={styles.adTop}><strong>{example.brand}</strong><span>Sample creative</span></div>
              <div className={styles.poster}>
                <div className={styles.posterCopy}><span>{example.brand}</span><h3>{example.headline}</h3><p>{example.business} / {example.location}</p></div>
                <Image src={example.image} alt={example.alt} width={1200} height={800} sizes="(max-width: 760px) 100vw, 650px" className={styles.adPhoto} />
              </div>
              <div className={styles.adCopy} aria-live="polite" aria-atomic="true"><p>{example.copy}</p><div><span>Suggested call to action</span><strong>{example.cta} <ArrowRight aria-hidden="true" size={16} /></strong></div></div>
            </article>
          </div>
          <div className={styles.exampleFoot}><span>Illustration only. Your creative depends on your brand, brief, and review.</span><a href={example.photoUrl} target="_blank" rel="noopener noreferrer">Photo source / Unsplash</a></div>
        </section>

        <section id="workflow" className={styles.workflow} aria-labelledby="workflow-title">
          <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>02 / FROM IDEA TO ENQUIRY</p><h2 id="workflow-title">More than something to post.</h2></div><Link href="/login" className={styles.textLink}>Start with your brand <ArrowRight size={18} aria-hidden="true" /></Link></div>
          <ol className={styles.steps}>
            <li><span>01</span><h3>Start with your customer</h3><p>Bring your offer, service areas, and brand voice. Set a goal, from a first enquiry to a consultation booking.</p></li>
            <li><span>02</span><h3>Find your message</h3><p>Create images and copy with AI. Compare the options, check the details, and approve what feels right for your business.</p></li>
            <li><span>03</span><h3>Build your campaign</h3><p>Export your creative or connect Meta. Choose your audience, enquiry destination, and budget. Nothing goes live automatically.</p></li>
            <li><span>04</span><h3>Keep the conversation going</h3><p>Sync campaign results and form enquiries. Review contact details and share a lead digest with your team for follow-up.</p></li>
          </ol>
        </section>

        <section className={styles.safety} aria-labelledby="safety-title">
          <div><ShieldCheck size={30} aria-hidden="true" /><p className={styles.eyebrow}>03 / YOU MAKE THE CALL</p><h2 id="safety-title">Your reputation.<br />Your decisions.</h2><p>AI helps with the work. You decide what represents your business, who you want to reach, and when to spend.</p></div>
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
      <footer className={styles.footer}><span>AdBrain / Customer-focused marketing for local businesses</span><nav aria-label="Legal">{LEGAL_LINKS.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}</nav></footer>
    </div>
  );
}