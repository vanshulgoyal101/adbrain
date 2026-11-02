import { describe, expect, it } from "vitest";
import { outcomeDefinition, type CampaignDestination } from "@/lib/campaign/outcomes";
import { cardFigures, cardResultCount } from "@/lib/campaign/card-figures";
import { storedResults } from "@/lib/campaign/result-evidence";
import { decodeAdResults, decodeCampaignInsights } from "@/lib/meta/insights";

const counts = { conversations: 3, leads: 7, landing_page_views: 11 };
const figures = { ...counts, spend: 231, cpl: 33, cost_per_conversation: 77 };
const cases = [
  ["whatsapp", "conversations", "conversations", "chat", 3],
  ["instant_form", "leads", "leads", "lead", 7],
  ["website", "landing_page_views", "landingPageViews", "visit", 11],
] as const;
const actions = [
  { action_type: "onsite_conversion.messaging_conversation_started_7d", value: "3" },
  { action_type: "lead", value: "7" },
  { action_type: "landing_page_view", value: "11" },
  { action_type: "omni_landing_page_view", value: "99" },
];

describe("shared outcome definition", () => {
  it.each(cases)("%s keeps campaign, ad and display results aligned", (destination, field, insightField, unit, count) => {
    const definition = outcomeDefinition(destination);
    expect(definition).toMatchObject({
      campaignField: field, adField: field, insightField, unit, comparable: true, metaValueActions: [],
    });
    expect(cardResultCount(destination, figures)).toBe(count);
    expect(storedResults(destination, counts)).toBe(count);
    expect(decodeCampaignInsights({ data: [{ actions, spend: "231" }] }, destination)[insightField]).toBe(count);
    expect(decodeAdResults({ data: [{ id: "123" }] }, { data: [{ ad_id: "123", actions, spend: "231" }] }, destination)[0].results).toBe(count);
  });

  it("keeps the existing ordered Meta count actions, without adding value actions", () => {
    expect(outcomeDefinition("whatsapp").metaActions).toEqual(["onsite_conversion.messaging_conversation_started_7d"]);
    expect(outcomeDefinition("instant_form").metaActions).toEqual(["lead", "onsite_conversion.lead_grouped"]);
    expect(outcomeDefinition("website").metaActions).toEqual(["landing_page_view", "omni_landing_page_view"]);
  });

  it.each(["traffic", "leads", "sales", null, undefined])("does not add a website goal for objective %s", (objective) => {
    expect(outcomeDefinition("website", objective)).toEqual(outcomeDefinition("website"));
  });

  it.each(["unknown", "mixed", "call"] satisfies CampaignDestination[])("%s retains legacy counts but no card verdict figures", (destination) => {
    expect(outcomeDefinition(destination)).toMatchObject({ campaignField: "leads", comparable: false });
    expect(cardResultCount(destination, figures)).toBe(7);
    expect(cardFigures(destination, figures)).toEqual({ label: "figures.unavailable", value: "—", costLabel: "figures.costResult", cost: "—" });
  });

  it("preserves unread WhatsApp versus zero website counts and stored versus derived costs", () => {
    const unread = { ...figures, conversations: null, landing_page_views: null, cpl: 5 };
    expect(cardFigures("whatsapp", unread).value).toBe("—");
    expect(cardFigures("whatsapp", unread).cost).toBe("—");
    expect(cardFigures("website", unread).value).toBe("0");
    expect(cardFigures("website", unread).cost).toBe("—");
    expect(cardFigures("instant_form", unread).cost).toBe("₹5");
    expect(cardFigures("whatsapp", { ...figures, cost_per_conversation: 8 }).cost).toBe("₹8");
    expect(cardFigures("website", { ...figures, cpl: 5 }).cost).toBe("₹21");
  });
});
