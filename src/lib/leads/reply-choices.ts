/**
 * #1945 (CPO brief #1938): "WhatsApp them" for a pilot segment (solar, IELTS, interiors) offers 3 first replies,
 * and 2 follow-ups once the enquiry has had a first contact. Every other business keeps today's single generic
 * reply (#1049). Each is still the owner's own message, opened in WhatsApp; nothing is sent automatically.
 * Rules: `{date}` only when set (its sentence, or a chip that is only the date, drops); the interiors photo
 * follow-up only when the owner has their own photos (#1617); first person is "hum"/ungendered, never "main …unga".
 */
import { segmentForCategory } from "@/lib/segments";
import { firstReplyText, offerWords, type ReplyLanguage } from "@/lib/leads/first-reply";

export type ReplyChoices = { kind: "first" | "follow-up" | "generic"; texts: string[] };

type Words = { hi: string; business: string; offer: string | null; date: string | null; ownPhotos: boolean };
type Lines = { opener: (w: Words) => string; first: Array<(w: Words) => string>; followUps: Array<(w: Words) => string | null> };

const capital = (text: string) => text[0].toUpperCase() + text.slice(1);

const COPY: Record<string, Record<ReplyLanguage, Lines>> = {
  solar: {
    en: {
      opener: (w) => `${w.hi} this is ${w.business}. Thanks for ${w.offer ? `asking about ${w.offer}` : "your enquiry"}! `,
      first: [
        () => "Which area is your home in, and roughly what's your monthly electricity bill?",
        () => "Can we book your free site survey? Is tomorrow or the day after better?",
        () => "Is your roof flat (RCC) or sloped, and about how big? That decides the system size.",
      ],
      followUps: [
        (w) => `${w.hi} just checking: shall we book the free site survey this week?`,
        (w) => `${w.hi} if the price is the question, I can send a rough estimate from your bill. Want it?`,
      ],
    },
    hinglish: {
      opener: (w) => `${w.hi} ${w.business} se. ${w.offer ? `${capital(w.offer)} ke baare mein poochne` : "Poochne"} ke liye thanks! `,
      first: [
        () => "Aapka ghar kis area mein hai, aur bijli ka bill mahine ka lagbhag kitna aata hai?",
        () => "Free site survey book kar dein? Kal ya parson, kab theek rahega?",
        () => "Chhat flat (RCC) hai ya slope wali, aur lagbhag kitni badi? Usse system size tay hota hai.",
      ],
      followUps: [
        (w) => `${w.hi} free site survey is hafte book kar dein?`,
        (w) => `${w.hi} agar sawaal price ka hai to aapke bill se rough estimate bhej doon?`,
      ],
    },
    hi: {
      opener: (w) => `${w.hi} ${w.business} से। ${w.offer ? `${capital(w.offer)} के बारे में पूछने` : "पूछने"} के लिए धन्यवाद! `,
      first: [
        () => "आपका घर किस एरिया में है, और बिजली का बिल महीने का लगभग कितना आता है?",
        () => "फ़्री साइट सर्वे बुक कर दें? कल या परसों, कब ठीक रहेगा?",
        () => "छत फ्लैट (RCC) है या स्लोप वाली, और लगभग कितनी बड़ी? उससे सिस्टम साइज़ तय होता है।",
      ],
      followUps: [
        (w) => `${w.hi} फ़्री साइट सर्वे इस हफ़्ते बुक कर दें?`,
        (w) => `${w.hi} अगर सवाल कीमत का है तो आपके बिल से रफ़ एस्टिमेट भेज दूँ?`,
      ],
    },
  },
  ielts: {
    en: {
      opener: (w) => `${w.hi} this is ${w.business}. Thanks for your message! `,
      first: [
        () => "Which test are you preparing for, and when would you like to take it?",
        (w) => `${w.date ? `Our next batch starts ${w.date}. ` : ""}Would you like a free demo class first?`,
        () => "Which country and intake are you aiming for? We'll suggest the right course.",
      ],
      followUps: [
        (w) => w.date ? `${w.hi} a seat in the ${w.date} batch is still open. Shall I hold one for you?` : null,
        (w) => `${w.hi} would a free demo class help you decide? When suits you?`,
      ],
    },
    hinglish: {
      opener: (w) => `${w.hi} ${w.business} se. Message ke liye thanks! `,
      first: [
        () => "Kaunse test ki taiyari hai, aur kab dena chahte ho?",
        (w) => `${w.date ? `Agla batch ${w.date} se shuru hai. ` : ""}Pehle ek free demo class lenge?`,
        () => "Kaunsa desh aur intake soch rahe ho? Hum aapko sahi course bata denge.",
      ],
      followUps: [
        (w) => w.date ? `${w.hi} ${w.date} batch mein seat abhi khaali hai. Aapke liye rakh doon?` : null,
        (w) => `${w.hi} free demo class se decide karna aasaan hoga. Kab theek rahega?`,
      ],
    },
    hi: {
      opener: (w) => `${w.hi} ${w.business} से। मैसेज के लिए धन्यवाद! `,
      first: [
        () => "किस टेस्ट की तैयारी है, और कब देना चाहते हैं?",
        (w) => `${w.date ? `अगला बैच ${w.date} से शुरू है। ` : ""}पहले एक फ़्री डेमो क्लास लेंगे?`,
        () => "कौन-सा देश और इनटेक सोच रहे हैं? हम आपको सही कोर्स बता देंगे।",
      ],
      followUps: [
        (w) => w.date ? `${w.hi} ${w.date} बैच में सीट अभी खाली है। आपके लिए रख दूँ?` : null,
        (w) => `${w.hi} फ़्री डेमो क्लास से तय करना आसान होगा। कब ठीक रहेगा?`,
      ],
    },
  },
  interiors: {
    en: {
      opener: (w) => `${w.hi} this is ${w.business}. Thanks for ${w.offer ? `asking about ${w.offer}` : "your enquiry"}! `,
      first: [
        () => "Which area is your home in, and is it a kitchen, wardrobes or the full home?",
        () => "When do you get possession? We can plan around it.",
        () => "Can we set up your free design consultation? A site visit takes about 30 minutes.",
      ],
      followUps: [
        (w) => `${w.hi} just checking: shall we fix the free design consultation this week?`,
        (w) => w.ownPhotos ? `${w.hi} if it helps, I can share photos of kitchens we've finished nearby.` : null,
      ],
    },
    hinglish: {
      opener: (w) => `${w.hi} ${w.business} se. ${w.offer ? `${capital(w.offer)} ke baare mein poochne` : "Poochne"} ke liye thanks! `,
      first: [
        () => "Ghar kis area mein hai, aur kitchen, wardrobe ya poora ghar?",
        () => "Possession kab mil raha hai? Hum uske hisaab se plan kar sakte hain.",
        () => "Free design consultation fix kar dein? Site visit mein lagbhag 30 minute lagte hain.",
      ],
      followUps: [
        (w) => `${w.hi} free design consultation is hafte fix kar dein?`,
        (w) => w.ownPhotos ? `${w.hi} chahein to paas mein bane kitchens ki photos bhej doon?` : null,
      ],
    },
    hi: {
      opener: (w) => `${w.hi} ${w.business} से। ${w.offer ? `${capital(w.offer)} के बारे में पूछने` : "पूछने"} के लिए धन्यवाद! `,
      first: [
        () => "घर किस एरिया में है, और किचन, वार्डरोब या पूरा घर?",
        () => "पज़ेशन कब मिल रहा है? हम उसके हिसाब से प्लान कर सकते हैं।",
        () => "फ़्री डिज़ाइन कंसल्टेशन फिक्स कर दें? साइट विज़िट में लगभग 30 मिनट लगते हैं।",
      ],
      followUps: [
        (w) => `${w.hi} फ़्री डिज़ाइन कंसल्टेशन इस हफ़्ते फिक्स कर दें?`,
        (w) => w.ownPhotos ? `${w.hi} चाहें तो पास में बने किचन की फ़ोटो भेज दूँ?` : null,
      ],
    },
  },
};

export function replyChoices(input: {
  leadName?: string | null;
  businessName: string;
  offer?: string | null;
  /** The business type (`businesses.vertical`, free text); its pilot segment picks the lines. */
  vertical?: string | null;
  language: ReplyLanguage;
  /** The enquiry has had a first contact (`first_contacted_at`, or this session's tap). */
  contacted: boolean;
  /** An IELTS batch's start, as the owner wrote it; none today, so its sentence drops. */
  batchDate?: string | null;
  /** The owner has their own photos (a `product_photo` brand asset). */
  ownPhotos?: boolean;
}): ReplyChoices {
  const lines = COPY[segmentForCategory(input.vertical)?.slug ?? ""]?.[input.language];
  if (!lines) return { kind: "generic", texts: [firstReplyText(input)] };
  const name = input.leadName?.trim().split(/\s+/)[0] ?? "";
  const words: Words = {
    hi: `${input.language === "hi" ? "नमस्ते" : "Hi"}${name ? ` ${name}` : ""},`,
    business: input.businessName.trim(),
    offer: offerWords(input.offer),
    date: input.batchDate?.trim() || null,
    ownPhotos: input.ownPhotos === true,
  };
  if (input.contacted) {
    return { kind: "follow-up", texts: lines.followUps.map((line) => line(words)).filter((text): text is string => text !== null) };
  }
  const opener = lines.opener(words);
  return { kind: "first", texts: lines.first.map((line) => opener + line(words)) };
}
