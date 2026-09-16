export interface MarketingGuide {
  slug: string;
  title: string;
  description: string;
  updated: string;
  sections: { title: string; paragraphs: string[]; checklist?: string[] }[];
}

export const MARKETING_GUIDES: MarketingGuide[] = [
  {
    slug: "ad-creative-sizes",
    title: "Ad Creative Sizes for Facebook and Instagram",
    description: "Compare AdBrain's square, portrait, story and landscape exports. Plan readable copy, protect your subject from cropping, and review every placement.",
    updated: "2026-09-16",
    sections: [
      {
        title: "Choose a composition before generating",
        paragraphs: [
          "A square image, a tall story and a landscape image do not offer the same space for a subject and headline. In AdBrain, choose the intended format before generation so the concept can reserve room for the offer, brand and call to action.",
          "The table below lists AdBrain's finished export sizes, not a promise that every Meta placement accepts or displays them identically. Meta may crop or adapt an asset. Preview the selected placements in the destination platform before activation.",
        ],
      },
      {
        title: "Source photo size is not finished ad size",
        paragraphs: [
          "An image provider may return a different aspect ratio or resolution from the one requested. AdBrain validates the actual raster dimensions and composes the final export at the selected size. Enlarging a small source does not recover missing detail.",
          "Review both the original image and the finished creative. Headline overlays can hide anatomy, product or equipment errors. A realistic-looking AI image is not proof that a depicted product or service detail is accurate.",
        ],
      },
      {
        title: "Keep the message readable",
        paragraphs: [
          "Use one main offer and a short headline. Keep essential text and logos away from image edges and busy details. Story and feed interfaces can cover different areas; there is no single safe margin that guarantees every placement.",
          "Inspect the export at phone size. If the text is difficult to read, shorten it or change the composition instead of relying on a higher-resolution download. Check the actual crop and preview, not just the file dimensions.",
        ],
        checklist: [
          "The format matches the intended placement.",
          "The offer, spelling, price and contact details match the business.",
          "The subject remains identifiable after cropping.",
          "The headline and CTA remain legible on a phone.",
          "The finished export has been previewed in the destination platform.",
        ],
      },
    ],
  },
  {
    slug: "meta-campaign-checklist",
    title: "A Meta Lead Campaign Checklist for Local Businesses",
    description: "Review the offer, creative, account, Page, audience, lead form and budget before creating a paused Facebook or Instagram lead campaign with AdBrain.",
    updated: "2026-09-16",
    sections: [
      {
        title: "Start with a claim you can support",
        paragraphs: [
          "Write down the service, service area and offer before asking AI for creative. Supply accurate prices, eligibility, dates and business details. Do not turn a suggestion into a promise of guaranteed results, sales or health outcomes.",
          "AdBrain checks structured concepts before generating images, but automated checks do not establish that every statement is true or compliant. The business owner must review the claims, image and copy before approval.",
        ],
      },
      {
        title: "Confirm the account and Page",
        paragraphs: [
          "Creative generation and export do not require a Meta connection. Publishing requires an eligible ad account, a Facebook Page and the permissions needed for the chosen workflow. Meta controls consent, permissions, review and account restrictions.",
          "A saved draft is not a published campaign. Confirm the business, ad account and Page shown in the review. If connection or consent fails, keep the draft and resolve the blocker; do not substitute another business's account to get past the error.",
        ],
        checklist: [
          "The connected ad account and Page belong to the intended business.",
          "The account currency, billing and permissions are understood.",
          "The chosen instant form and privacy-policy link are correct.",
        ],
      },
      {
        title: "Review delivery and the total budget",
        paragraphs: [
          "Check included and excluded service areas, radius and age range against the business's real customer coverage. Audience suggestions are a starting point, not a guarantee that Meta will deliver qualified leads.",
          "Review the total daily budget, including split tests. AdBrain creates campaigns paused; activation is a separate decision. Advertising spend is billed by Meta. A spend alert or auto-pause check is not a guaranteed hard cap because reporting and enforcement can lag.",
        ],
        checklist: [
          "Every selected creative has been reviewed and approved.",
          "Locations and exclusions match the service area.",
          "The total budget includes every test arm.",
          "The campaign is created paused and inspected before activation.",
        ],
      },
      {
        title: "Plan the response to each enquiry",
        paragraphs: [
          "Decide who will read form enquiries and how they will follow up with consent. AdBrain can sync Meta instant-form enquiries and prepare a digest. It does not automatically contact people or track calls and WhatsApp conversations as form leads.",
          "Assess lead quality and real business outcomes alongside cost per lead. A small number of impressions or attractive creative is not enough evidence to scale a budget. Keep a record of what changed when comparing results.",
        ],
      },
    ],
  },
];

export function findMarketingGuide(slug: string): MarketingGuide | undefined {
  return MARKETING_GUIDES.find((guide) => guide.slug === slug);
}