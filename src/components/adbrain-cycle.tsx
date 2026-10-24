"use client";

import { useState } from "react";
import Image from "next/image";
import { Check, Pause, Play, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import styles from "./adbrain-cycle.module.css";

const STOPS = [
  { id: "brand", title: "Tell us about your business" },
  { id: "ads", title: "AdBrain makes 3 ads in about a minute" },
  { id: "approve", title: "You approve the one you like" },
  { id: "live", title: "It runs on Facebook and Instagram, within your daily limit" },
  { id: "chats", title: "Customers message you on WhatsApp" },
  { id: "results", title: "See what you spent and what you got" },
] as const;

type StopId = (typeof STOPS)[number]["id"];

function Screen({ id }: { id: StopId }) {
  switch (id) {
    case "brand":
      return (
        <div className={styles.brandCard}>
          <p className={styles.cardTitle}>Solaride</p>
          <dl>
            <div><dt>Business</dt><dd>Rooftop solar installer</dd></div>
            <div><dt>Area</dt><dd>Chandigarh, Mohali, Panchkula</dd></div>
            <div><dt>Offer</dt><dd>Free site survey</dd></div>
            <div><dt>Customers reach you on</dt><dd>WhatsApp</dd></div>
          </dl>
        </div>
      );
    case "ads":
      return (
        <div className={styles.adStack}>
          <div className={styles.miniAd}><Image src="/solaride-ad.webp" alt="" width={180} height={225} sizes="120px" /></div>
          <div className={cn(styles.miniAd, styles.miniPoster)} data-tone="dusk"><p>Free site survey this week</p></div>
          <div className={cn(styles.miniAd, styles.miniPoster)} data-tone="day"><p>Subsidy help, start to finish</p></div>
        </div>
      );
    case "approve":
      return (
        <div className={styles.approve}>
          <Image src="/solaride-ad.webp" alt="" width={360} height={450} sizes="200px" />
          <p className={styles.approved}><Check size={16} aria-hidden="true" /> Approved</p>
          <p className={styles.approveNote}>Nothing goes live until you approve it.</p>
        </div>
      );
    case "live":
      return (
        <div className={styles.live}>
          <p className={styles.activePill}><span aria-hidden="true" /> Active</p>
          <p className={styles.liveBudget}>₹280 a day</p>
          <p className={styles.liveNote}>Stops on its own after 3 days. Pause any time.</p>
        </div>
      );
    case "chats":
      return (
        <div className={styles.chat}>
          <p className={styles.chatHead}>WhatsApp</p>
          <p className={styles.bubbleIn}>Namaste! Mujhe free site survey ke baare mein jaankari chahiye.</p>
          <p className={styles.bubbleOut}>Ji zaroor! Aapka area kaunsa hai?</p>
          <p className={styles.bubbleIn}>Sector 21, Panchkula</p>
        </div>
      );
    case "results":
      return (
        <div className={styles.results}>
          <dl>
            <div><dt>Spent</dt><dd>₹840</dd></div>
            <div><dt>WhatsApp chats</dt><dd>12</dd></div>
            <div><dt>Cost per chat</dt><dd>₹70</dd></div>
          </dl>
          <p className={styles.smarter}><RefreshCw size={15} aria-hidden="true" /> Your next 3 ads learn from this</p>
        </div>
      );
  }
}

/**
 * The make-and-run loop as phone "stories" built from app-style UI.
 * Example content; reduced motion shows all six stops as a still grid.
 */
/** `fill` drops the phone frame and fills its container (the full-screen phone intro). */
export function AdbrainCycle({ className, showSteps = false, fill = false }: { className?: string; showSteps?: boolean; fill?: boolean }) {
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);
  const [stopped, setStopped] = useState(false);
  const paused = held || stopped;
  const stop = STOPS[index];
  const go = (next: number) => setIndex((next + STOPS.length) % STOPS.length);

  return (
    <div className={cn(styles.cycle, showSteps && styles.withSteps, fill && styles.fill, className)}>
      <div
        role="region"
        aria-roledescription="carousel"
        aria-label="How AdBrain works"
        className={cn(styles.stories, paused && styles.paused)}
        onPointerEnter={(event) => { if (event.pointerType === "mouse") setHeld(true); }}
        onPointerLeave={() => setHeld(false)}
        onPointerDown={() => setHeld(true)}
        onPointerUp={(event) => { if (event.pointerType !== "mouse") setHeld(false); }}
        onPointerCancel={() => setHeld(false)}
        onFocus={(event) => { if (event.target.matches(":focus-visible")) setHeld(true); }}
        onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setHeld(false); }}
      >
        <div className={styles.progress} aria-hidden="true">
          {STOPS.map((item, i) => (
            <span key={item.id} className={i < index ? styles.done : undefined}>
              {i === index && <i key={index} onAnimationEnd={() => go(index + 1)} />}
            </span>
          ))}
        </div>
        <div className={styles.top}>
          <p className={styles.example}>Example</p>
          <button type="button" className={styles.pause} onClick={() => setStopped(!stopped)} aria-label={stopped ? "Play" : "Pause"}>
            {stopped ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
          </button>
        </div>
        <div className={styles.stop} aria-live={paused ? "polite" : "off"} aria-atomic="true">
          <p className={styles.stopTitle}><span className="sr-only">Step {index + 1} of {STOPS.length}: </span>{stop.title}</p>
          <div key={stop.id} className={styles.screen}><Screen id={stop.id} /></div>
        </div>
        <button type="button" className={styles.prev} onClick={() => go(index - 1)} aria-label="Previous step" />
        <button type="button" className={styles.next} onClick={() => go(index + 1)} aria-label="Next step" />
      </div>
      {showSteps && (
        <ol className={styles.steps}>
          {STOPS.map((item, i) => (
            <li key={item.id}>
              <button type="button" aria-current={i === index ? "step" : undefined} onClick={() => setIndex(i)}><span aria-hidden="true">{i + 1}</span>{item.title}</button>
            </li>
          ))}
        </ol>
      )}
      <div className={styles.still}>
      <p className={styles.example}>Example</p>
      <ol aria-label="How AdBrain works (example)">
        {STOPS.map((item) => (
          <li key={item.id}>
            <p className={styles.stopTitle}>{item.title}</p>
            <div className={styles.screen}><Screen id={item.id} /></div>
          </li>
        ))}
      </ol>
      </div>
    </div>
  );
}
