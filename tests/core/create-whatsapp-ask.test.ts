import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildConceptMessages, validateConcept } from "@/lib/creative/concept";
import { quotedAsk } from "@/lib/campaign/whatsapp-greeting";
import { AD_ANGLES, type BrandContext } from "@/lib/templates/ads";
import regenerate from "./fixtures/create/solaride-regenerate.json";
import run4 from "./fixtures/create/cedar-ridge-run4.json";

// #1147 copy half (CEO: the first pilot's blocker): a WhatsApp business's ads ask for a WhatsApp message and never
// to call. The model gets no phone or email for such a business, and is told the button opens a chat. Same rule as
// the poster's contact bar (#1167): an India-based phone or a saved WhatsApp message. Others keep their number.
const FIXTURES = join(__dirname, "fixtures/create");
const request = (brand: BrandContext & { whatsapp_template?: unknown }) => {
  const [system, user] = buildConceptMessages({ brand, brief: regenerate.brief, angle: AD_ANGLES[0] });
  return { system: system.content as string, user: JSON.parse(user.content as string) };
};

describe("core: a WhatsApp business's copy asks for a WhatsApp message, never a call (#1147)", () => {
  it("Solaride (+91): no phone or email reaches the model, and the request says the button opens WhatsApp", () => {
    const { system, user } = request({ ...(regenerate.brand as BrandContext), phone: "+91 73802 80874", email: "hello@solaride.in" });
    expect(user.contact).toBe("whatsapp");
    expect(user.brand.phone).toBeUndefined();
    expect(user.brand.email).toBeUndefined();
    expect(JSON.stringify(user)).not.toMatch(/73802|hello@solaride/);
    expect(system).toMatch(/When contact\s+is "whatsapp", the ad's button opens a WhatsApp chat: the last line asks people to message on WhatsApp,\s+and the ad never asks them to call, phone or email \(and never picks "Call Now"\)/);
  });

  it("a saved WhatsApp message makes any business a WhatsApp one; a US clinic without one keeps its number", () => {
    const cedar = { ...(run4.brand as BrandContext), phone: "+1 512 555 0142" };
    expect(request(cedar).user).toMatchObject({ contact: "any", brand: { phone: "+1 512 555 0142" } });
    expect(request({ ...cedar, whatsapp_template: { greeting: "Hi" } }).user.contact).toBe("whatsapp");
    expect(request({ ...cedar, whatsapp_template: { greeting: "Hi" } }).user.brand.phone).toBeUndefined();
  });

  it("before: recorded Haiku copy asked people to call", () => {
    expect(readFileSync(join(FIXTURES, "cedar-ridge-haiku.json"), "utf8")).toMatch(/\bor call\b/);
  });
});

describe("core: the last line points to WhatsApp, added when the model's doesn't (#1147)", () => {
  const replies = regenerate.replies.map((reply) => JSON.parse(reply.content.replace(/^```json\s*|\s*```\s*$/g, "")));
  const input = (brand: BrandContext, language?: string) => ({ brand, brief: regenerate.brief, angle: AD_ANGLES.find((angle) => angle.name === regenerate.angle) ?? AD_ANGLES[0], instructions: regenerate.instructions, sourceFacts: regenerate.sourceFacts, language });
  const solaride = { ...(regenerate.brand as BrandContext), phone: "+91 73802 80874" };

  it("adds 'Message us on WhatsApp.' to recorded Solaride copy that ends without it, and leaves a WhatsApp ending alone", () => {
    let added = 0;
    for (const reply of replies) {
      const result = validateConcept(reply, input(solaride));
      if (!result.success) continue;
      const last = result.concept.primary_text.split("\n").at(-1)!;
      expect(last, reply.headline).toMatch(/WhatsApp/);
      if (!/WhatsApp/.test(reply.primary_text.split("\n").filter(Boolean).at(-1) ?? "")) {
        added++;
        expect(result.concept.primary_text).toBe(`${reply.primary_text.trimEnd()}\nMessage us on WhatsApp.`);
      }
    }
    expect(added).toBeGreaterThan(0);
    const ends = { ...replies[0], primary_text: `${replies[0].primary_text.split("\n")[0]}\nWhatsApp us to book your free site survey.` };
    const kept = validateConcept(ends, input(solaride));
    expect(kept.success && kept.concept.primary_text).toBe(ends.primary_text);
  });

  it("speaks the ad's language, and changes nothing for a business that isn't WhatsApp-first", () => {
    const hindi = { ...replies[0], primary_text: "31 दिसंबर से पहले सोलर लगवाएं।\nफ्री साइट सर्वे बुक करें।" };
    const result = validateConcept(hindi, input(solaride, "Hindi in Devanagari script"));
    expect(result.success ? result.concept.primary_text.split("\n").at(-1) : result.issues).toBe("WhatsApp पर मैसेज करें।");
    const cedarLike = { ...(regenerate.brand as BrandContext), phone: "+1 512 555 0142" };
    for (const reply of replies) {
      const other = validateConcept(reply, input(cedarLike));
      if (other.success) expect(other.concept.primary_text).toBe(reply.primary_text);
    }
  });
});

describe("core: the WhatsApp line keeps a quoted ask last, and Call Now becomes Contact Us (#1364)", () => {
  const replies = regenerate.replies.map((reply) => JSON.parse(reply.content.replace(/^```json\s*|\s*```\s*$/g, "")));
  const solaride = { ...(regenerate.brand as BrandContext), phone: "+91 73802 80874" };
  const input = (brand: BrandContext) => ({ brand, brief: regenerate.brief, angle: AD_ANGLES.find((angle) => angle.name === regenerate.angle) ?? AD_ANGLES[0], instructions: regenerate.instructions, sourceFacts: regenerate.sourceFacts });

  it("a recorded concept ending in a quoted ask keeps it last, so the pre-typed message still reads it (#1027)", () => {
    const lines = replies[0].primary_text.split("\n").filter(Boolean);
    const quoted = { ...replies[0], primary_text: [...lines.slice(0, -1), "Send “Free site survey” to book."].join("\n") };
    const result = validateConcept(quoted, input(solaride));
    expect(result.success).toBe(true);
    if (!result.success) return;
    const out = result.concept.primary_text.split("\n");
    expect(out.at(-1)).toBe("Send “Free site survey” to book.");
    expect(out.at(-2)).toBe("Message us on WhatsApp.");
    expect(quotedAsk(result.concept.primary_text)).toBe("Free site survey");
  });

  it("stores Contact Us instead of Call Now for a WhatsApp business only", () => {
    const call = { ...replies[0], cta: "Call Now" };
    const whatsapp = validateConcept(call, input(solaride));
    expect(whatsapp.success && whatsapp.concept.cta).toBe("Contact Us");
    const other = validateConcept(call, input({ ...(regenerate.brand as BrandContext), phone: "+1 512 555 0142" }));
    expect(other.success && other.concept.cta).toBe("Call Now");
  });
});

