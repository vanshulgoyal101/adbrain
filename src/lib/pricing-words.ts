/**
 * #1652 (CPO words, CEO ok): the public pricing block on the homepage, linked from /for/<segment>.
 * No margin, split or fee words (#1235); no GST claim on the ₹999 plan until #1845 closes.
 */
export const PRICING_POINTS: { lead: string; text: string }[] = [
  { lead: "Your first campaign: set up free, with you.", text: "We make your ads and go live together in about 20 minutes." },
  { lead: "Then ₹999 a month for AdBrain.", text: "Your first month is free, counted from your first Go live." },
  {
    lead: "Your ads, your money.",
    text: "You pay Meta directly from your own ad account, with a daily limit you set. Meta adds 18% GST to your ad spend; that's Meta's charge, not ours.",
  },
  { lead: "No auto-debit.", text: "Each month you get a payment link. Pay it only if you want to keep making new ads. Stop any time." },
  {
    lead: "Included:",
    text: "ads made for your business, going live and pausing from your phone, your results with what each enquiry costs, and every enquiry in one place.",
  },
];

export const PRICING_FAQS: { question: string; answer: string }[] = [
  { question: "Do you take a cut of my ad money?", answer: "No. Your ad money goes from your account straight to Meta. AdBrain charges only ₹999 a month." },
  {
    question: "What if I don't pay the ₹999?",
    answer: "Your running ads keep running and your results stay. New ads and new campaigns wait until you pay. Nothing is deleted.",
  },
  { question: "How much should I spend on ads?", answer: "We suggest starting at ₹300 a day. You choose the amount, and it stops at the limit you set." },
  { question: "Can you promise enquiries?", answer: "No. Your first run shows what your ads bring, and you see what each enquiry costs." },
  {
    question: "Can I stop, or get my money back?",
    answer:
      "Yes, stop any time. There's no contract and no auto-debit. If you've paid and haven't started a new campaign that month, we refund the ₹999 in full on request. Once a new campaign goes live that month, that month isn't refunded.",
  },
];
