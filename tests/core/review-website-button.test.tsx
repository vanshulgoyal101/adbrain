// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import recorded from "./fixtures/meta/launch-validate-website.json";
import { WebsiteReviewFact } from "@/components/campaign-destination";
import { destinationCTA } from "@/lib/meta/client";

// #2703: the button Review shows for a website ad is the one launch sends, and Meta accepted each one
// (launch-validate-website.json: the default creative is LEARN_MORE, plus adcreatives-cta-SHOP_NOW and -SIGN_UP).
type Exchange = { kind: string; form: Record<string, string> };
const tape = recorded.tape as unknown as Exchange[];
const tapedType = (kind: string) => JSON.parse(tape.find((e) => e.kind === kind)!.form.object_story_spec).link_data.call_to_action.type as string;
const SHOWN_TO_META: Record<string, string> = {
  [en.campaigns.destination.buttonLearnMore]: "LEARN_MORE",
  [en.campaigns.destination.buttonShopNow]: "SHOP_NOW",
  [en.campaigns.destination.buttonSignUp]: "SIGN_UP",
};

describe("#2703 Review's website button matches launch and the tape", () => {
  it.each([["Book Now", "adcreatives"], ["Shop Now", "adcreatives-cta-SHOP_NOW"], ["Sign up", "adcreatives-cta-SIGN_UP"]])(
    "%s shows the button Meta accepted in %s",
    (cta, kind) => {
      const { container } = render(<WebsiteReviewFact url={recorded.inputs.link} ads={[{ headline: "Offer", cta }]} />);
      const shown = container.textContent!.split(`${en.campaigns.destination.button}: `)[1];
      expect(SHOWN_TO_META[shown]).toBe(tapedType(kind));
      expect(destinationCTA("website", { link: recorded.inputs.link, ctaLabel: cta }).type).toBe(tapedType(kind));
    },
  );
});
