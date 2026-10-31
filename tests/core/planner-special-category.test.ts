import { describe, expect, it } from "vitest";
import recorded from "./fixtures/planner/groq-meta-interest-names.json";
import { effectiveSpecialCategory, plannerPlanToDraftInput } from "@/lib/campaign/planner-draft";

// #1671 (CTO, Analyst #1514 ①): the top pilot-visit risk is the planner labelling an interiors offer as housing, or a
// shop's 'EMI available' as credit, which blocks the whole launch. Meta's credit and housing categories cover lenders'
// own offers and property; interiors have no special category in India. The recorded Groq plan is replayed with each
// label the model could give (radius filled as the route does); only a real lender, property seller or recruiter keeps the block.
const { plan } = JSON.parse(recorded.text) as { plan: Record<string, unknown> & { creative_ids: string[]; lead_form_id: string } };
const draft = (special_ad_category: string, business?: { vertical: string; offers: string[] }) => plannerPlanToDraftInput({
  businessId: "11111111-1111-4111-8111-111111111111", goal: "Leads", plan: { ...plan, radius_km: 25, special_ad_category }, approvedCreativeIds: plan.creative_ids, leadFormIds: [plan.lead_form_id], business,
});

const interiors = { vertical: "modular kitchens and home interiors", offers: ["Free 3D design visit in Mohali"] };
const solarEmi = { vertical: "rooftop solar installer", offers: ["Easy EMI available", "PM Surya Ghar subsidy help"] };
const ielts = { vertical: "IELTS coaching", offers: ["Free demo class in Mohali"] };
const lender = { vertical: "personal loans (NBFC)", offers: ["Personal loan at 11% p.a., approval in 24 hours"] };

describe("core: an interiors or 'EMI available' offer never becomes a special category (#1671)", () => {
  it("the recorded plan itself prepares as a normal campaign", () => {
    expect(draft("none", interiors).ok).toBe(true);
  });

  it.each([
    ["interiors read as housing", "housing", interiors],
    ["solar 'EMI available' read as credit", "financial_products_services", solarEmi],
    ["IELTS coaching read as employment", "employment", ielts],
    ["solar credit-card EMI read as credit", "financial_products_services", { vertical: "Solar installation", offers: ["no-cost EMI on all credit cards"] }],
    ["kitchen bank EMI read as credit", "financial_products_services", { vertical: "Modular kitchens", offers: ["Easy EMI with HDFC Bank"] }],
    ["flat interiors read as housing", "housing", { vertical: "Home interiors", offers: ["2BHK flat interiors"] }],
  ])("%s still prepares (no launch block)", (_case, label, business) => {
    const result = draft(label, business);
    expect(result.ok, result.ok ? "" : result.error).toBe(true);
  });

  it("a lender's own loan offer keeps the financial category and its block", () => {
    const result = draft("financial_products_services", lender);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toMatch(/special-category review/);
  });

  it.each([
    ["employment", { vertical: "Domestic help agency", offers: ["UPI accepted"] }],
    ["employment", { vertical: "Domestic help agency", offers: ["cards accepted"] }],
    ["employment", { vertical: "IELTS coaching", offers: ["Jobs placement available"] }],
    ["financial_products_services", { vertical: "", offers: ["EMI available"] }],
    ["housing", { vertical: "  ", offers: ["2BHK interiors"] }],
  ])("keeps the %s launch block without evidence that the business is exempt", (category, business) => {
    const result = draft(category, business);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toMatch(/special-category review/);
  });

  it("keeps the block for property sellers, recruiters, an unknown label, and when the business isn't known", () => {
    expect(effectiveSpecialCategory("housing", { vertical: "real estate agent", offers: ["2BHK flats in Kharar"] })).toBe("housing");
    expect(effectiveSpecialCategory("employment", { vertical: "overseas jobs placement and coaching", offers: [] })).toBe("employment");
    expect(effectiveSpecialCategory("unknown", interiors)).toBe("unknown");
    expect(effectiveSpecialCategory("issues_elections_politics", interiors)).toBe("issues_elections_politics");
    expect(draft("financial_products_services").ok).toBe(false);
  });

  // QA at 255e5e5: the planner's label is the judgement, so only a business plainly outside the category is demoted.
  it.each([
    ...["Financial advisor", "Wealth management", "Microfinance", "Chit fund", "Nidhi company", "Share trading academy",
      "Loan DSA", "Mutual fund distributor", "Insurance agent", "Gold loan", "Stock market classes"]
      .map((vertical) => ["financial_products_services", vertical] as const),
    ...["Realtor", "Estate agent", "Land dealer", "Township project", "Paying guest", "Real estate agent", "Property dealer", "Residential colony"]
      .map((vertical) => ["housing", vertical] as const),
  ])("keeps %s for a '%s'", (category, vertical) => {
    expect(effectiveSpecialCategory(category, { vertical, offers: [] })).toBe(category);
  });

  it("an offer selling a financial product keeps the block; how customers pay doesn't", () => {
    expect(effectiveSpecialCategory("financial_products_services", { vertical: "Tax consultant", offers: ["Start a SIP in mutual funds"] })).toBe("financial_products_services");
    expect(effectiveSpecialCategory("financial_products_services", { vertical: "Rooftop solar", offers: ["Solar loan in 48 hours"] })).toBe("financial_products_services");
    expect(effectiveSpecialCategory("financial_products_services", { vertical: "Solar", offers: ["EMI on credit cards", "HDFC Bank EMI"] })).toBe("none");
  });

  // #2097: an offer that only mentions a policy, an investment or "sip" sells no financial product.
  it.each([
    ["Electronics shop", "No-cost EMI, 7-day return policy"],
    ["Mobile store", "Easy exchange policy"],
    ["Home interiors", "Smart investment for your home"],
    ["Art cafe", "Sip and paint workshop"],
    ["Juice bar", "sip a fresh juice for ₹49"],
  ])("a '%s' offering '%s' is not financial", (vertical, offer) => {
    expect(effectiveSpecialCategory("financial_products_services", { vertical, offers: [offer] })).toBe("none");
  });

  it.each([
    ["Tax consultant", "Start a SIP in mutual funds"],
    ["Tax consultant", "SIPs from ₹500 a month"],
    ["Tax consultant", "LIC policy at your doorstep"],
    ["Tax consultant", "Term policies for your family"],
    ["Tax consultant", "Health insurance policy renewal"],
    ["Tax consultant", "Investment plans for retirement"],
    ["Tax consultant", "Fixed deposit at 8%"],
  ])("a '%s' offering '%s' keeps the financial block", (vertical, offer) => {
    expect(effectiveSpecialCategory("financial_products_services", { vertical, offers: [offer] })).toBe("financial_products_services");
  });

  // #2370: Indian wording for rooms to let and pawn or money lending keeps the planner's label (and the launch block).
  it.each([
    ...["Rooms on rent", "Room rent", "Rooms for rent", "Rooms", "Furnished rooms", "To-let rooms for students", "Rent house",
      "Ghar kiraye par", "Makan kiraye par", "Kiraya ghar", "1RK available", "Flatmate wanted"]
      .map((vertical) => ["housing", vertical] as const),
    ...["Pawn broker", "Pawnbroker", "Pawn shop", "Money lender", "Moneylender", "Gold loan",
      "Sood par paisa", "Girvi par paisa", "Byaj par loan"]
      .map((vertical) => ["financial_products_services", vertical] as const),
  ])("keeps %s for a '%s' (#2370)", (category, vertical) => {
    expect(effectiveSpecialCategory(category, { vertical, offers: [] })).toBe(category);
  });

  it.each(["Living room interiors", "Kids room decor", "Modular kitchen and room makeover", "Bathroom fittings showroom",
    "Bike on rent", "Bike for rent", "Car rental", "Tent house on rent", "Hotel rooms", "Room heater dealer"])(
    "a '%s' labelled housing still prepares as none (#2370)", (vertical) => {
      expect(effectiveSpecialCategory("housing", { vertical, offers: [] })).toBe("none");
    });

  it("a place name that starts with 'pawn' isn't a lender (#2370)", () => {
    expect(effectiveSpecialCategory("financial_products_services", { vertical: "Pawna Lake camping", offers: [] })).toBe("none");
  });
});
