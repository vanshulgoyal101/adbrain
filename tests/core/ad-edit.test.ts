import { afterEach, describe, expect, it, vi } from "vitest";
import { MetaClient, editedCreativeForm } from "@/lib/meta/client";
import recorded from "./fixtures/meta/ad-edit.json";

// ad-edit.json: #499's paused ad and its creative as Meta stores them, and Meta's validate_only
// answers for the edited creative and the ad swap (scripts/record-meta-ad-edit.ts, nothing created).
const creds = { adAccountId: "act_9000000000000001", pageId: "900000000000002", accessToken: "test-token" };
type Sent = { method: string; path: string; form: Record<string, string> };

function replay(overrides: { confirmCreative?: string; accountId?: string; refuseCreative?: boolean } = {}) {
  const sent: Sent[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    url.searchParams.delete("access_token");
    const method = init?.method ?? "GET";
    const path = decodeURIComponent(url.pathname.replace("/v21.0/", "") + url.search);
    const form = init?.body instanceof URLSearchParams ? Object.fromEntries([...init.body].filter(([key]) => key !== "access_token")) : {};
    sent.push({ method, path, form });
    const validateOnly = form.execution_options === JSON.stringify(["validate_only"]);
    if (method === "GET" && path.startsWith("AD?fields=id,account_id")) return Response.json({ ...recorded.ad, ...(overrides.accountId ? { account_id: overrides.accountId } : {}) });
    if (method === "GET" && path === "AD?fields=creative{id}") return Response.json({ creative: { id: overrides.confirmCreative ?? "NEW_CREATIVE" } });
    if (method === "POST" && path.endsWith("/adcreatives")) {
      if (overrides.refuseCreative) return Response.json({ error: { message: "Invalid parameter", type: "OAuthException", code: 100, error_subcode: 1487390 } }, { status: 400 });
      return validateOnly ? Response.json(recorded.validated.creative.body, { status: recorded.validated.creative.status }) : Response.json({ id: "NEW_CREATIVE" });
    }
    if (method === "POST" && path === "AD") return validateOnly ? Response.json(recorded.validated.swap.body, { status: recorded.validated.swap.status }) : Response.json({ success: true });
    throw new Error(`Unrecorded Graph call: ${method} ${path}`);
  });
  return sent;
}

afterEach(() => vi.restoreAllMocks());

describe("core: edit a launched ad's words (#775)", () => {
  it("makes a new creative from the stored one with only the words changed, validated first, then points the ad at it", async () => {
    const sent = replay();
    const result = await new MetaClient(creds).replaceAdCreative("AD", recorded.edit);
    expect(result).toEqual({ adId: "AD", previousCreativeId: recorded.ad.creative.id, creativeId: "NEW_CREATIVE" });
    const posts = sent.filter((call) => call.method === "POST");
    expect(posts.map((call) => `${call.path}${call.form.execution_options ? " (validate)" : ""}`)).toEqual([
      `${creds.adAccountId}/adcreatives (validate)`, `${creds.adAccountId}/adcreatives`, "AD (validate)", "AD"]);
    // The creative sent is exactly the one Meta accepted with validate_only.
    expect(posts[0].form).toEqual({ ...recorded.form, execution_options: JSON.stringify(["validate_only"]) });
    expect(posts[1].form).toEqual(recorded.form);
    expect(posts[3].form).toEqual({ creative: JSON.stringify({ creative_id: "NEW_CREATIVE" }) });
    // Only the body changed: images, 9:16 rules, CTA, link and WhatsApp message are Meta's own.
    const before = recorded.ad.creative.asset_feed_spec as Record<string, unknown>;
    const after = JSON.parse(recorded.form.asset_feed_spec) as Record<string, unknown>;
    expect(after.bodies).toEqual([{ text: recorded.edit.message }]);
    expect({ ...after, bodies: before.bodies }).toEqual(before);
    expect(JSON.parse(recorded.form.object_story_spec)).toEqual(recorded.ad.creative.object_story_spec);
  });

  it("refuses an ad outside the connected account before changing anything", async () => {
    const sent = replay({ accountId: "999" });
    await expect(new MetaClient(creds).replaceAdCreative("AD", recorded.edit)).rejects.toThrow("connected ad account");
    expect(sent.filter((call) => call.method === "POST")).toEqual([]);
  });

  it("stops before touching the ad when Meta refuses the new creative", async () => {
    const sent = replay({ refuseCreative: true });
    await expect(new MetaClient(creds).replaceAdCreative("AD", recorded.edit)).rejects.toBeDefined();
    expect(sent.filter((call) => call.method === "POST" && call.path === "AD")).toEqual([]);
  });

  it("says so when Meta doesn't confirm the ad now uses the new creative", async () => {
    replay({ confirmCreative: recorded.ad.creative.id });
    await expect(new MetaClient(creds).replaceAdCreative("AD", recorded.edit)).rejects.toThrow("didn't confirm");
  });

  it("edits a single-image ad's link_data, and the WhatsApp message only where the ad has one", () => {
    const single = { name: "Old", object_story_spec: { page_id: "P", link_data: { image_hash: "H", message: "Old body", name: "Old title", page_welcome_message: "{}" } } };
    const form = editedCreativeForm(single, { headline: "New title", whatsappGreeting: { autofill: "Hi! I'd like a free solar site survey.", greeting: "Hi!" } });
    const story = JSON.parse(form.object_story_spec);
    expect(form.name).toBe("New title");
    expect(story.link_data).toMatchObject({ image_hash: "H", message: "Old body", name: "New title" });
    expect(JSON.parse(story.link_data.page_welcome_message).text_format.message.autofill_message.content).toBe("Hi! I'd like a free solar site survey.");
    expect(() => editedCreativeForm({ object_story_spec: { link_data: { message: "x" } } }, { whatsappGreeting: { autofill: "a", greeting: "b" } })).toThrow("no WhatsApp message");
    expect(() => editedCreativeForm(single, { message: "  " })).toThrow("Change at least one part");
  });
});
