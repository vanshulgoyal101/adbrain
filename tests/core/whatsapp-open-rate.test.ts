import { describe, expect, it } from "vitest";
import recorded from "./fixtures/meta/whatsapp-results.json";
import { decodeCampaignInsights } from "@/lib/meta/insights";

// #493: Meta's real insights for the live #157 WhatsApp campaign (read-only GET, Oct 24).
// link_click = people who opened WhatsApp from the ad; messaging_conversation_started_7d = sent a message.
describe("core: WhatsApp opened vs messaged (#493)", () => {
  it("reads opens and messages from #157's recorded answer: 12 opened, 1 messaged", () => {
    const insights = decodeCampaignInsights(recorded.payload, "whatsapp");
    expect(insights).toMatchObject({ whatsappOpens: 12, conversations: 1, clicks: 15 });
  });

  it("does not report WhatsApp opens for a lead-form campaign", () => {
    expect(decodeCampaignInsights(recorded.payload, "instant_form")).not.toHaveProperty("whatsappOpens");
  });
});
