import { describe, expect, it } from "vitest";
import { policyFindings } from "@/lib/creative/policy-rules";

const rules = (text: string, vertical = "chiropractic clinic", facts: string[] = []) =>
  policyFindings(text, { vertical, facts }).map((finding) => finding.rule);

describe("policyFindings (#738)", () => {
  it("blocks naming the reader's condition in a health ad, and allows naming the service", () => {
    expect(rules("Are you suffering from back pain?")).toEqual(["personal-attribute"]);
    expect(rules("Do you have bleeding gums?", "Dental clinic")).toEqual(["personal-attribute"]);
    expect(rules("We can help with your back pain.")).toEqual(["personal-attribute"]);
    expect(rules("Back pain care in Austin")).toEqual([]);
    expect(rules("Same-day visits for desk strain and sports injuries in Austin.")).toEqual([]);
    expect(rules("Free 15-minute spine check")).toEqual([]);
    // A non-health business may talk about pain points.
    expect(rules("Tired of roof leaks?", "roofing")).toEqual([]);
  });

  it("catches the four production ads the policy audit sampled", () => {
    expect(rules("Desk strain or a sports injury in Austin? Start with a $49 new-patient exam.")).toEqual(["personal-attribute"]);
    expect(rules("Overdue for a Dental Check-up?", "Dental clinic")).toEqual(["personal-attribute"]);
    // CTO (#805): outside health, a figure the Brand states is allowed; an uncited one is refused.
    expect(rules("Potential to cut electricity bills by up to 98%.", "solar energy", ["Cut electricity bills by up to 98%"])).toEqual([]);
    expect(rules("Potential to cut electricity bills by up to 98%.", "solar energy")).toEqual(["exaggerated-result"]);
    expect(rules("Up to 90% less back pain.", "chiropractic clinic", ["Up to 90% less back pain"])).toEqual(["exaggerated-result"]);
    expect(rules("मोहाली में बिजली का बिल भारी लग रहा है? मुफ़्त साइट सर्वे बुक करें।", "solar energy")).toEqual(["personal-attribute"]);
    expect(rules("Rooftop solar se bill mein up to 98% tak kami ho sakti hai.", "solar energy")).toEqual(["exaggerated-result"]);
    expect(rules("Rooftop solar se bill mein up to 98% tak kami ho sakti hai.", "solar energy", ["Save up to 98 % on bills"])).toEqual([]);
  });

  it("allows a statement about bills, and blocks a question about the reader's money trouble", () => {
    expect(rules("Festive lights shouldn't come with a bigger electricity bill.", "solar energy")).toEqual([]);
    expect(rules("Is your electricity bill too high?", "solar energy")).toEqual(["personal-attribute"]);
    expect(rules("Struggling to pay your bills?", "solar energy")).toEqual(["personal-attribute"]);
    expect(rules("Factory ka bijli bill bhari?", "solar energy")).toEqual(["personal-attribute"]);
    // Cost, not the reader's means: allowed.
    expect(rules("Bijli Bill Se Pareshan? Chhat Dekhiye", "solar energy")).toEqual([]);
    expect(rules("फैक्ट्री का बिजली बिल बढ़ रहा है?", "solar energy")).toEqual([]);
  });

  // Reviewer on #805: everyday copy that must not trip the rules (every hit forces a repair).
  it("passes everyday copy that only looks like a claim", () => {
    expect(rules("Fix your appointment today at Sunrise Dental, Kothrud.", "Dental clinic")).toEqual([]);
    expect(rules("We eliminate waiting time with online booking.", "Dental clinic")).toEqual([]);
    expect(rules("Solar panels leading to lower bills every month.", "solar energy")).toEqual([]);
    expect(rules("AC broke down? Same-day repair in Mohali.", "AC repair")).toEqual([]);
    expect(rules("Are you broke after every bill?", "solar energy")).toEqual(["personal-attribute"]);
    expect(rules("Austin's leading chiropractor")).toEqual(["unsupported-superlative"]);
  });

  it("blocks a superlative no supplied fact states", () => {
    expect(rules("Austin's #1 chiropractor")).toEqual(["unsupported-superlative"]);
    expect(rules("The best dental care in Kothrud", "Dental clinic")).toEqual(["unsupported-superlative"]);
    expect(rules("Rated Austin's #1 chiropractor", "chiropractic clinic", ["Voted #1 chiropractor in Austin 2025"])).toEqual([]);
    expect(rules("What works best for your roof", "solar energy")).toEqual([]);
  });

  // #941 rule 8 (Analyst): promises still running in the Ad Library that Meta treats as misleading.
  it("blocks zero-cost, result-or-refund and timed-result promises no fact states", () => {
    expect(rules("Rooftop solar with zero investment.", "solar energy")).toEqual(["exaggerated-result"]);
    expect(rules("₹0 down payment on your 3 kW system.", "solar energy")).toEqual(["exaggerated-result"]);
    expect(rules("Zero cost installation.", "solar energy")).toEqual(["exaggerated-result"]);
    expect(rules("₹0 down payment on your 3 kW system.", "solar energy", ["₹0 down payment with bank EMI"])).toEqual([]);
    expect(rules("No band, no fee. Join our IELTS batch.", "IELTS coaching")).toEqual(["exaggerated-result"]);
    expect(rules("Money-back promise on every repair.", "AC repair")).toEqual(["exaggerated-result"]);
    expect(rules("No band no fee.", "IELTS coaching", ["No band, no fee"])).toEqual([]);
    expect(rules("New teeth in days at our Kothrud clinic.", "Dental clinic")).toEqual(["exaggerated-result"]);
    expect(rules("See results in 7 days.", "Dental clinic", ["See results in 7 days"])).toEqual(["exaggerated-result"]);
    expect(rules("Speak fluently in 30 days.", "spoken English coaching")).toEqual(["exaggerated-result"]);
    expect(rules("Fluency in 30 days with daily practice.", "spoken English coaching")).toEqual(["exaggerated-result"]);
    expect(rules("Fluency in 30 days with daily practice.", "spoken English coaching", ["Fluency course: 30 days"])).toEqual([]);
  });

  it("passes everyday copy near the rule-8 words", () => {
    expect(rules("Installation in 3 days after the site survey.", "solar energy")).toEqual([]);
    expect(rules("Book a free site survey; no cost to visit.", "solar energy")).toEqual([]);
    expect(rules("Results you can see in your monthly bill.", "solar energy")).toEqual([]);
    expect(rules("Our 0-investment model is explained on the call.", "solar energy", ["0 investment RESCO model"])).toEqual([]);
    expect(rules("Same-day appointments for new patients.")).toEqual([]);
  });
});
