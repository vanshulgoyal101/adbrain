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
  ])("%s still prepares (no launch block)", (_case, label, business) => {
    const result = draft(label, business);
    expect(result.ok, result.ok ? "" : result.error).toBe(true);
  });

  it("a lender's own loan offer keeps the financial category and its block", () => {
    const result = draft("financial_products_services", lender);
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
});
