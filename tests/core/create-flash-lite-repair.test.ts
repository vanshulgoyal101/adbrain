import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import recorded from "./fixtures/gemini/flash-lite-concepts.json";
import evalCases from "../eval/cases.json";
import { googleReply, requestBody, requestUrl } from "./replay";

// #2444: on production's free text model (gemini-3.5-flash-lite, #2189), repeated headlines were the top rejection
// (~18 of 32 calls on Oct 31). The one repair asked for a fresh concept, so flash-lite wrote the same lines again and the
// ad was lost. Now the repair shows the model its own draft and asks it to change only what failed (CTO, Oct 31).
// First replies: flash-lite's recorded replies to the eval gate case. The repair reply is that recorded draft with only
// the failing headline rewritten, the reply this repair asks for; flash-lite's own repair replies aren't recorded yet.
const item = evalCases.cases.find((entry) => entry.id === "cedar-ridge-en")!;
const offer = recorded.replies.find((reply) => reply.case === item.id && reply.angle === "offer")!;
const draft = JSON.parse(offer.text.replace(/\n/g, "\\n")) as { headline: string; primary_text: string };
// DevOps (Oct 31, #2189): the business's last ads already used the offer as their headline.
const recentCopy = [{ headline: draft.headline, primary_text: "Same-day appointments for new patients in Austin.\nMessage us to book." }];

vi.mock("@/lib/imageGen", () => ({
  generateImage: async (req: { prompt: string; width: number; height: number }) => ({
    url: "https://core-test.supabase.co/storage/v1/object/public/creatives/repair.webp", provider: "cloudflare",
    model: "flux", prompt: req.prompt, width: req.width, height: req.height,
  }),
}));

beforeEach(() => {
  vi.resetModules();
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: "https://core-test.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
    OPENROUTER_API_KEYS: "", GOOGLE_AI_API_KEYS: "core-google", GROQ_API_KEYS: "", CEREBRAS_API_KEYS: "",
    LLM_PROVIDER_ORDER: "google", CREATIVE_PROVIDER_ORDER: "google", GEMINI_MODEL: "gemini-3.5-flash-lite",
    CREATIVE_CONCEPT_SCHEDULE: "parallel",
  })) vi.stubEnv(name, value);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

type Turn = { role: string; parts: { text: string }[] };
async function create(replies: string[]) {
  const requests: Turn[][] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(requestUrl(input));
    if (url.hostname !== "generativelanguage.googleapis.com") throw new Error(`Unexpected request to ${url.hostname}${url.pathname}`);
    expect(url.pathname).toContain("gemini-3.5-flash-lite");
    requests.push(JSON.parse(requestBody(init)).contents);
    return googleReply(replies[requests.length - 1]);
  }));
  const { generateVariants } = await import("@/lib/creative/generate");
  const variants = await generateVariants({
    brand: item.brand, brief: item.brief, language: item.language, sourceFacts: item.sourceFacts,
    angleIds: ["offer"], count: 1, recentCopy, onFailure: async () => {},
  });
  return { variants, requests };
}

describe("core: the repair keeps flash-lite's draft and changes only what failed (#2444)", () => {
  it("a repeated headline is rewritten and the rest of the recorded draft is kept", async () => {
    const repaired = { ...draft, headline: "Your first visit in Cedar Park" };
    const { variants, requests } = await create([offer.text, JSON.stringify(repaired)]);

    expect(requests).toHaveLength(2);
    const [, model, ask] = requests[1];
    expect(model.role).toBe("model");
    expect(JSON.parse(model.parts[0].text)).toEqual(draft);
    expect(ask.role).toBe("user");
    expect(ask.parts[0].text).toMatch(/rewrite only what these failures name and keep every other field exactly as it is/);
    expect(ask.parts[0].text).toContain(`repeated-headline: "${draft.headline}" is a recent ad's headline`);

    expect(variants).toHaveLength(1);
    expect(variants[0].concept.headline).toBe("Your first visit in Cedar Park");
    expect(variants[0].concept.primary_text).toBe(draft.primary_text);
    expect(variants[0].llmUsage.map((entry) => entry.validation?.rules ?? [])).toEqual([["repeated-headline"], []]);
  });

  it("a reply that isn't JSON leaves no draft, so its repair still asks for a fresh concept", async () => {
    const { variants, requests } = await create(["Here is a concept for Cedar Ridge Chiropractic.", offer.text.replace(draft.headline, "Your first visit in Cedar Park")]);

    expect(requests[1].map((turn) => turn.role)).toEqual(["user", "user"]);
    expect(requests[1][1].parts[0].text).toMatch(/^Generate a fresh, complete JSON concept/);
    expect(variants).toHaveLength(1);
  });

  it("a headline over 40 characters goes back with its length, and the draft's copy is kept", async () => {
    const long = { ...draft, headline: "Start with a $49 new-patient exam in Cedar Park" };
    const { variants, requests } = await create([JSON.stringify(long), offer.text.replace(draft.headline, "Your first visit in Cedar Park")]);

    expect(requests[1].map((turn) => turn.role)).toEqual(["user", "model", "user"]);
    expect(requests[1][2].parts[0].text).toMatch(/schema:headline:too_big: .*; it is 47 characters/);
    expect(variants[0].concept.primary_text).toBe(draft.primary_text);
  });

  it("a draft with an unsupported offer isn't sent back: its repair starts fresh (Oct 1)", async () => {
    const invented = { ...draft, primary_text: `50% off X-rays on your first visit.\n${draft.primary_text}` };
    const { requests } = await create([JSON.stringify(invented), offer.text.replace(draft.headline, "Your first visit in Cedar Park")]);

    expect(requests[1].map((turn) => turn.role)).toEqual(["user", "user"]);
    expect(requests[1][1].parts[0].text).toMatch(/^Generate a fresh, complete JSON concept[\s\S]*unsupported-commercial-claim/);
    expect(JSON.stringify(requests[1])).not.toContain("50% off X-rays");
  });

  it("an over-long headline doesn't hide an unsupported offer: the repair still starts fresh (QA #2444)", async () => {
    const both = { ...draft, headline: "Start with a $49 new-patient exam in Cedar Park", primary_text: `50% off X-rays on your first visit.\n${draft.primary_text}` };
    const { requests } = await create([JSON.stringify(both), offer.text.replace(draft.headline, "Your first visit in Cedar Park")]);

    expect(requests[1].map((turn) => turn.role)).toEqual(["user", "user"]);
    expect(requests[1][1].parts[0].text).toMatch(/schema:headline:too_big[\s\S]*unsupported-commercial-claim/);
    expect(JSON.stringify(requests[1])).not.toContain("50% off X-rays");
  });

  it("an over-long headline keeps the uncited claim on the attempt's receipt (QA #2444)", async () => {
    const [{ validateConcept }, { AD_ANGLES }] = await Promise.all([import("@/lib/creative/concept"), import("@/lib/templates/ads")]);
    const input = { brand: item.brand, brief: item.brief, angle: AD_ANGLES.find((angle) => angle.id === "offer")!, sourceFacts: item.sourceFacts };
    const both = { ...draft, headline: "Start with a $49 new-patient exam in Cedar Park", primary_text: `50% off X-rays on your first visit.\n${draft.primary_text}` };
    expect(validateConcept(both, input)).toMatchObject({ success: false, claims: ["claim:percent:uncited"] });
  });

  it("an offer past the cut point of a too-long text is still caught (review #2444)", async () => {
    const late = { ...draft, primary_text: `${draft.primary_text}\n${"Gentle care. ".repeat(70)}\nGet 50% off X-rays.` };
    const { requests } = await create([JSON.stringify(late), offer.text.replace(draft.headline, "Your first visit in Cedar Park")]);

    expect(requests[1].map((turn) => turn.role)).toEqual(["user", "user"]);
    expect(requests[1][1].parts[0].text).toMatch(/schema:primary_text:too_big[\s\S]*unsupported-commercial-claim/);
  });

  it.each([
    ["isn't the concept's shape", { cta: 42 }],
    ["has too many quotes", { sourceQuotes: Array(9).fill("Free 15-minute spine check") }],
  ])("a draft that %s can't be checked, so its repair starts fresh", async (_, change) => {
    const { requests } = await create([JSON.stringify({ ...draft, ...change }), offer.text.replace(draft.headline, "Your first visit in Cedar Park")]);

    expect(requests[1].map((turn) => turn.role)).toEqual(["user", "user"]);
  });

  it("a repair that repeats the headline again still loses the ad", async () => {
    const { variants, requests } = await create([offer.text, offer.text]);

    expect(requests).toHaveLength(2);
    expect(variants).toHaveLength(0);
  });
});
