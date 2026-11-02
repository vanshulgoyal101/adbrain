import { describe, expect, it } from "vitest";
import recorded from "./fixtures/meta/video-creative-validate.json";
import launch from "./fixtures/meta/launch-validate.json";
import { whatsappWelcomeMessage } from "@/lib/meta/client";
import { videoStorySpec, type VideoCreativeInput } from "@/lib/meta/media";

// #749: Meta's validate_only answers for an owner's video ad (scripts/record-meta-video-creatives.ts, scrubbed):
// the creative and the ad under a PAUSED lead-form and WhatsApp ad set (from the recorded launch), nothing created to run.
type Exchange = { destination: string; kind: string; form: Record<string, string>; status: number; body: { error?: { code: number; error_subcode: number } } };
const tape = recorded.tape as unknown as Exchange[];
const sent = (destination: string, kind: string) => tape.find((exchange) => exchange.destination === destination && exchange.kind === kind)!;

const base = {
  pageId: "PAGE", videoId: "VIDEO", thumbnailUrl: "https://scontent.example/video-thumbnail.jpg",
  message: launch.inputs.creative.message, headline: launch.inputs.creative.headline, description: launch.inputs.creative.description,
};
const inputs: Record<"instant_form" | "whatsapp", VideoCreativeInput> = {
  instant_form: { ...base, destination: "instant_form", leadFormId: "LEAD_FORM" },
  whatsapp: { ...base, destination: "whatsapp", welcomeMessage: whatsappWelcomeMessage(launch.inputs.whatsappGreeting) },
};

describe("core: an owner's video ad is a payload Meta accepted (#749)", () => {
  for (const destination of ["instant_form", "whatsapp"] as const) {
    it(`${destination}: the video creative is byte-identical to the one Meta validated, and so is its PAUSED ad`, () => {
      const creative = sent(destination, "adcreatives");
      expect(creative.status).toBe(200);
      expect(JSON.stringify(videoStorySpec(inputs[destination]))).toBe(creative.form.object_story_spec);
      const ad = sent(destination, "ads");
      expect(ad.status).toBe(200);
      expect(ad.form.status).toBe("PAUSED");
    });
  }

  it("Meta refuses the image ad's WhatsApp button (with a link) on a video, so the video's button has none", () => {
    const control = sent("whatsapp", "control-adcreatives-whatsapp-link");
    expect(control.status).toBe(400);
    expect(control.body.error).toMatchObject({ code: 105, error_subcode: 1815630 });
    expect(videoStorySpec(inputs.whatsapp).video_data.call_to_action).toEqual({ type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } });
  });

  it("the lead form, the welcome and the words go where the image ad puts them", () => {
    const lead = videoStorySpec(inputs.instant_form).video_data;
    expect(lead).toMatchObject({ video_id: "VIDEO", title: base.headline, message: base.message, link_description: base.description });
    expect(lead.call_to_action).toEqual({ type: "LEARN_MORE", value: { lead_gen_form_id: "LEAD_FORM" } });
    expect(lead).not.toHaveProperty("page_welcome_message");
    expect(videoStorySpec(inputs.whatsapp).video_data.page_welcome_message).toBe(inputs.whatsapp.welcomeMessage);
    expect(videoStorySpec({ ...inputs.instant_form, description: "  " }).video_data).not.toHaveProperty("link_description");
  });
});
