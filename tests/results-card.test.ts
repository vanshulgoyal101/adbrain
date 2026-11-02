import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { RESULTS_CARD_EVENTS, cardArea, cardLines, cardPhone, pickThumbnail, resultsCardOffered } from "@/lib/results-card/offer";
import { renderResultsCard } from "@/lib/results-card/render";

// #2036 (CPO spec #2018): the weekly results card. Offered at 5 logged enquiries in 7 days, never shows money.
const now = Date.parse("2026-10-29T10:00:00Z");
const daysAgo = (n: number) => new Date(now - n * 86_400_000).toISOString();

describe("results card offer (#2036)", () => {
  it("is offered at 5 logged enquiries in the last 7 days, not at 4; chats alone log none", () => {
    expect(resultsCardOffered({ enquiries: 4, area: "Sector 70", events: [], now })).toBe(false);
    expect(resultsCardOffered({ enquiries: 5, area: "Sector 70", events: [], now })).toBe(true);
    // Raw WhatsApp chats are never counted: only leads the owner logged reach `enquiries`.
    expect(resultsCardOffered({ enquiries: 0, area: "Sector 70", events: [], now })).toBe(false);
  });

  it("hides for 7 days after Share or Not this week, then offers again while the week holds", () => {
    for (const name of [RESULTS_CARD_EVENTS.shared, RESULTS_CARD_EVENTS.dismissed]) {
      expect(resultsCardOffered({ enquiries: 9, area: "Jaipur", events: [{ name, created_at: daysAgo(6) }], now })).toBe(false);
      expect(resultsCardOffered({ enquiries: 9, area: "Jaipur", events: [{ name, created_at: daysAgo(7) }], now })).toBe(true);
    }
    // Being shown doesn't hide it.
    expect(resultsCardOffered({ enquiries: 9, area: "Jaipur", events: [{ name: RESULTS_CARD_EVENTS.shown, created_at: daysAgo(0) }], now })).toBe(true);
  });

  it("needs an area for the card's line", () => {
    expect(resultsCardOffered({ enquiries: 9, area: null, events: [], now })).toBe(false);
    expect(cardArea({ locations: ["  ", " Sector 70, Gurugram "] })).toBe("Sector 70, Gurugram");
    expect(cardArea({ locations: [] })).toBeNull();
  });

  it("writes the CPO's four card lines, with no money and no digits beyond n, the phone and the area", () => {
    const phone = cardPhone("+91 98765-43210");
    expect(phone).toBe("+91 98765 43210");
    const lines = (["en", "hinglish", "hi", "pa"] as const).map((language) => cardLines(language, { n: 7, area: "Sector 70", phone }));
    expect(lines.map((line) => line.main)).toEqual([
      "7 people in Sector 70 enquired with us this week",
      "Is hafte Sector 70 ke 7 logon ne humse enquiry ki",
      "इस हफ़्ते Sector 70 के 7 लोगों ने हमसे पूछताछ की",
      "ਇਸ ਹਫ਼ਤੇ Sector 70 ਦੇ 7 ਲੋਕਾਂ ਨੇ ਸਾਡੇ ਤੋਂ ਪੁੱਛਗਿੱਛ ਕੀਤੀ",
    ]);
    expect(lines.map((line) => line.contact)).toEqual([
      "WhatsApp us: +91 98765 43210", "WhatsApp karein: +91 98765 43210", "WhatsApp करें: +91 98765 43210", "WhatsApp ਕਰੋ: +91 98765 43210",
    ]);
    for (const { main, contact } of lines) {
      const text = `${main}\n${contact}`;
      expect(text).not.toMatch(/₹|\bRs\.?\b|rupee|रुपये|ਰੁਪਏ/i);
      expect(text.replace("Sector 70", "").replace("+91 98765 43210", "").replace(/\b7\b/, "")).not.toMatch(/\d/);
    }
    expect(cardLines("en", { n: 5, area: "Jaipur", phone: null }).contact).toBeNull();
    expect(cardPhone("not a phone")).toBeNull();
  });

  it("puts the ad with the most chats on the card, an owner-photo ad first when tied", () => {
    const ads = [
      { id: "a", imageUrl: "https://x/a.jpg", yours: false },
      { id: "b", imageUrl: "https://x/b.jpg", yours: true },
      { id: "c", imageUrl: "https://x/c.jpg", yours: false },
    ];
    expect(pickThumbnail(ads, new Map([["a", 4], ["b", 2], ["c", 9]]))).toBe("https://x/c.jpg");
    expect(pickThumbnail(ads, new Map([["a", 4], ["b", 4]]))).toBe("https://x/b.jpg");
    expect(pickThumbnail(ads, new Map())).toBe("https://x/b.jpg");
    expect(pickThumbnail([{ id: "a", imageUrl: null, yours: true }], new Map())).toBeNull();
  });
});

describe("results card picture (#2036)", () => {
  it("renders a 1080×1920 JPEG, in Hindi too", async () => {
    for (const language of ["en", "hi"] as const) {
      const jpeg = await renderResultsCard({
        businessName: "Sun Solar", logoUrl: null, primaryColor: "#0b5394", thumbnailUrl: null, footer: true,
        lines: cardLines(language, { n: 6, area: "Jaipur", phone: "+91 98765 43210" }),
      });
      const meta = await sharp(Buffer.from(jpeg)).metadata();
      expect(meta).toMatchObject({ format: "jpeg", width: 1080, height: 1920 });
    }
  }, 60_000);
});
