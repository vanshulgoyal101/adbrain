// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PauseAllAds } from "@/components/pause-all-ads";

// #1968 (CPO brief, #1956): one confirm, then each live campaign's existing emergency stop (PATCH status paused,
// which pauses campaign → ad sets → ads and reads them back), one at a time; never "all paused" unless each was.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const live = [
  { id: "c1", name: "Rooftop solar", meta_ad_account_id: "act_999", meta_campaign_id: "120001" },
  { id: "c2", name: "Solar EMI", meta_ad_account_id: "act_999", meta_campaign_id: "120002" },
];
let calls: { url: string; body: unknown }[] = [];
const stub = (fail: Set<string> = new Set()) => vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
  calls.push({ url, body: JSON.parse(String(init.body)) });
  const id = url.split("/").pop()!;
  return fail.has(id) ? Response.json({ error: "Meta didn't confirm the pause." }, { status: 502 }) : Response.json({ ok: true });
}));

beforeEach(() => { calls = []; });
afterEach(() => vi.unstubAllGlobals());

async function pauseAll(locale?: "hi") {
  const user = userEvent.setup();
  render(<PauseAllAds campaigns={live} locale={locale} />);
  await user.click(screen.getByRole("button", { name: locale ? "सारे विज्ञापन रोकें" : "Pause all ads" }));
  const dialog = screen.getByRole("dialog");
  return { user, dialog };
}

describe("core: Pause all ads (#1968)", () => {
  it("asks once, then pauses each live campaign with the existing stop and says so", async () => {
    stub();
    const { user, dialog } = await pauseAll();
    expect(within(dialog).getByText("Pause all your ads?")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("2 running campaigns will pause in Meta. Nothing is deleted, and nothing more will be spent once Meta stops them (usually within minutes). You can turn each one back on from Campaigns.");
    expect(within(dialog).getByRole("button", { name: "Keep running" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Pause all" }));
    expect(await screen.findByText("All 2 campaigns are paused. Nothing more will be spent.")).toBeInTheDocument();
    expect(calls).toEqual([{ url: "/api/campaigns/c1", body: { status: "paused" } }, { url: "/api/campaigns/c2", body: { status: "paused" } }]);
  });

  it("keeps running when the owner says so", async () => {
    stub();
    const { user, dialog } = await pauseAll();
    await user.click(within(dialog).getByRole("button", { name: "Keep running" }));
    expect(calls).toEqual([]);
  });

  it("says honestly which one didn't pause, with Try again and Open in Ads Manager", async () => {
    stub(new Set(["c2"]));
    const { user, dialog } = await pauseAll();
    await user.click(within(dialog).getByRole("button", { name: "Pause all" }));
    expect(await screen.findByText("1 of 2 paused. 'Solar EMI' didn't pause; tap Try again, or pause it in Meta Ads Manager.")).toBeInTheDocument();
    expect(screen.queryByText(/All 2 campaigns are paused/)).toBeNull();
    expect(screen.getByRole("link", { name: /Open in Ads Manager/ })).toHaveAttribute("href", expect.stringContaining("selected_campaign_ids=120002"));
    stub();
    calls = [];
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("All 2 campaigns are paused. Nothing more will be spent.")).toBeInTheDocument();
    expect(calls.map((call) => call.url)).toEqual(["/api/campaigns/c2"]);
  });

  it("is hidden with no live campaign", () => {
    const { container } = render(<PauseAllAds campaigns={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("speaks Hindi", async () => {
    stub();
    const { user, dialog } = await pauseAll("hi");
    expect(within(dialog).getByText("सारे विज्ञापन रोकें?")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "सब रोकें" }));
    expect(await screen.findByText("सभी 2 कैंपेन रुक गए। आगे कोई खर्च नहीं होगा।")).toBeInTheDocument();
  });
});
