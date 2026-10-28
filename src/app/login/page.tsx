import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Brain, MessageCircle, ShieldCheck, Timer } from "lucide-react";
import { LoginExperience } from "@/components/login-experience";
import { LEGAL_LINKS } from "@/lib/legal-links";
import { safeAuthRedirect } from "@/lib/auth-redirect";
import styles from "./login.module.css";

export const metadata = {
  title: "Create your account or sign in",
  description:
    "Create a free AdBrain account: make your first Facebook and Instagram ad in about 2 minutes, approve it before any money is spent, and get enquiries on WhatsApp.",
  alternates: { canonical: "/login" },
  // A thin auth page shouldn't compete with the landing in search.
  robots: { index: false, follow: true },
};

const PROMISES = [
  { icon: Timer, title: "Your first ad in about 2 minutes", body: "Tell us about your business. AdBrain writes and designs 3 ads to choose from." },
  { icon: ShieldCheck, title: "You approve before any money is spent", body: "Nothing goes live until you say so, and it stays within the daily limit you set." },
  { icon: MessageCircle, title: "Enquiries come to your WhatsApp", body: "Customers tap the ad and message you directly." },
];

export default async function LoginPage({ searchParams }: { searchParams?: Promise<{ redirect?: string | string[]; error?: string | string[] }> }) {
  const params = await searchParams;
  const redirect = params?.redirect;
  // Only a real in-app destination counts; the default /dashboard fallback does not.
  const deepLink = typeof redirect === "string" && safeAuthRedirect(redirect) === redirect;
  return (
    <div className={styles.page}>
      <a href="#sign-in" className={styles.skipLink}>Skip to sign in</a>
      <header className={styles.header}>
        <Link href="/" aria-label="AdBrain home" className={styles.logo}><Brain aria-hidden="true" size={26} /> AdBrain</Link>
        <Link href="/" className={styles.home}><ArrowLeft size={16} aria-hidden="true" /> Home</Link>
      </header>
      <main className={styles.main}>
        <section id="sign-in" tabIndex={-1} aria-labelledby="sign-in-title" className={styles.formColumn}>
          <div className={styles.formInner}>
            <LoginExperience deepLink={deepLink} failedSignIn={Boolean(params?.error)} />
          </div>
        </section>
        <aside className={styles.proof} aria-label="What you get">
          <figure className={styles.post}>
            <div className={styles.postHead}>
              <span className={styles.avatar} aria-hidden="true">S</span>
              <span><strong>Solaride</strong><span>Sponsored</span></span>
            </div>
            <p className={styles.postText}>Unsure if your roof can take solar? Free site survey first, plus PM Surya Ghar subsidy help from our team.</p>
            <Image src="/solaride-ad.webp" alt="Solaride ad: a rooftop solar installation at dusk, headline 'Wondering whether your roof is ready?'" width={720} height={900} sizes="300px" loading="eager" className={styles.postImage} />
            <div className={styles.postFoot}><span>Message on WhatsApp</span><span className={styles.cta}>Contact us</span></div>
            <figcaption>A real ad made with AdBrain for Solaride, a rooftop solar installer in Chandigarh.</figcaption>
          </figure>
          <ul className={styles.promises}>
            {PROMISES.map(({ icon: Icon, title, body }) => (
              <li key={title}><Icon size={20} aria-hidden="true" /><div><h2>{title}</h2><p>{body}</p></div></li>
            ))}
          </ul>
        </aside>
      </main>
      <footer className={styles.footer}>
        <span>AdBrain</span>
        <nav aria-label="Legal">
          {LEGAL_LINKS.map(({ href, label }) => <Link key={href} href={href}>{label}</Link>)}
        </nav>
      </footer>
    </div>
  );
}
