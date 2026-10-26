// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditAudienceDialog } from "@/components/edit-audience-dialog";
import { audienceChangeFromForm, emptyAudienceEdit } from "@/lib/campaign/editor-targeting";

// #773: Manage → Edit audience. Meta checks the change first (nothing written), the owner reads the
// consequence, then saves with the same idempotency key.
const RESTARTS = "This restarts Meta's learning; results may be slower for 2–3 days.";

describe("audienceChangeFromForm", () => {
  it("sends only what the owner changed", () => {
    expect(audienceChangeFromForm({
      ...emptyAudienceEdit,
      included: [{ key: "1029599", name: "Mohali", type: "city" }, { key: "1743", name: "Rajasthan", type: "region" }],
      excluded: [{ key: "in", name: "India", type: "country" }],
      radiusKm: 120,
      gender: "women",
    })).toEqual({ change: {
      location: { cities: [{ key: "1029599", radius: 80, distance_unit: "kilometer" }], regions: [{ key: "1743" }] },
      excludedLocation: { countries: ["IN"] },
      gender: "women",
    } });
    expect(audienceChangeFromForm({ ...emptyAudienceEdit, included: [{ key: "1029599", name: "Mohali", type: "city" }], cityScope: "city_only" }))
      .toEqual({ change: { location: { cities: [{ key: "1029599" }] } } });
  });

  it("refuses an empty change and half or out-of-range ages", () => {
    expect(audienceChangeFromForm(emptyAudienceEdit)).toHaveProperty("error");
    expect(audienceChangeFromForm({ ...emptyAudienceEdit, ageMin: 30 })).toEqual({ error: "Enter both ages, or leave both blank to keep them." });
    expect(audienceChangeFromForm({ ...emptyAudienceEdit, ageMin: 40, ageMax: 30 })).toEqual({ error: "Ages go from 18 to 65, youngest first." });
    expect(audienceChangeFromForm({ ...emptyAudienceEdit, ageMin: 30, ageMax: 60 })).toEqual({ change: { age: { min: 30, max: 60 } } });
  });
});

describe("EditAudienceDialog", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return Response.json(body.preview
        ? { ok: true, preview: { adSets: [{ adSetId: "s1", mode: "rebuild", validated: true }], consequence: RESTARTS } }
        : { ok: true, result: { adSets: [{ adSetId: "s2", previousAdSetId: "s1", mode: "rebuild" }], count: 1, consequence: RESTARTS } });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  const open = () => {
    const onSaved = vi.fn();
    render(<EditAudienceDialog campaignId="c-1" campaignName="Rooftop solar" onClose={vi.fn()} onSaved={onSaved} />);
    return onSaved;
  };
  const sent = (index: number) => JSON.parse(String((fetchMock.mock.calls[index][1] as RequestInit).body));

  it("checks with Meta, shows the consequence, then saves with the same key", async () => {
    const onSaved = open();
    fireEvent.change(screen.getByLabelText("Youngest"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Oldest"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: /Check with Meta/ }));
    expect(await screen.findByRole("status")).toHaveTextContent(`Meta accepted this change for 1 ad set. ${RESTARTS}`);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/campaigns/c-1/audience");
    expect(sent(0)).toMatchObject({ change: { age: { min: 30, max: 60 } }, preview: true });

    fireEvent.click(screen.getByRole("button", { name: /Save change/ }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(`Audience changed. The campaign stays paused. ${RESTARTS}`));
    expect(sent(1)).toEqual({ change: { age: { min: 30, max: 60 } }, idempotencyKey: sent(0).idempotencyKey });
  });

  it("a change after the check needs a fresh check and key; Meta's refusal is shown and nothing saves", async () => {
    open();
    fireEvent.change(screen.getByLabelText("Who sees the ads"), { target: { value: "women" } });
    fireEvent.click(screen.getByRole("button", { name: /Check with Meta/ }));
    await screen.findByRole("status");
    fireEvent.change(screen.getByLabelText("Who sees the ads"), { target: { value: "men" } });
    expect(screen.queryByRole("button", { name: /Save change/ })).toBeNull();

    fetchMock.mockResolvedValueOnce(Response.json({ error: "Pause the campaign first; editing a running campaign comes next." }, { status: 409 }));
    fireEvent.click(screen.getByRole("button", { name: /Check with Meta/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Pause the campaign first");
    expect(sent(1).idempotencyKey).not.toBe(sent(0).idempotencyKey);
    expect(screen.queryByRole("button", { name: /Save change/ })).toBeNull();
  });

  it("explains an empty change without calling Meta", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /Check with Meta/ }));
    expect(screen.getByRole("alert")).toHaveTextContent("Change the area, an exclusion, the ages or who sees the ads.");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
