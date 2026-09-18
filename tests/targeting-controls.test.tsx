// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InfoHint } from "@/components/ui/info-hint";
import {
  TargetingControls,
  defaultTargeting,
  type TargetingValue,
} from "@/components/targeting-controls";
import { targetingFromEditor, targetingToEditor } from "@/lib/campaign/editor-targeting";

const JAIPUR = { key: "1027633", name: "Jaipur", type: "city", region: "Rajasthan" };
const AJMER = { key: "999", name: "Ajmer", type: "city", region: "Rajasthan" };

const INCLUDE_PLACEHOLDER = "e.g. Jaipur, Rajasthan…";
const EXCLUDE_PLACEHOLDER = "e.g. exclude a city…";

const manual = (over: Partial<TargetingValue> = {}): TargetingValue => ({
  ...defaultTargeting,
  locationMode: "manual",
  ...over,
});

const setFetch = (results: unknown[]) => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ results }),
  }) as unknown as typeof fetch;
};

const view = (
  value: TargetingValue,
  onChange = vi.fn(),
  brandAreas: string[] = ["Jaipur"],
) => {
  render(
    <TargetingControls value={value} onChange={onChange} brandAreas={brandAreas} />,
  );
  return onChange;
};

/** Type into a picker and let the 300ms debounce elapse. */
async function search(term: string, placeholder = INCLUDE_PLACEHOLDER) {
  fireEvent.change(screen.getByPlaceholderText(placeholder), {
    target: { value: term },
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  setFetch([JAIPUR, AJMER]);
});

afterEach(() => vi.useRealTimers());

describe("targeting help", () => {
  it("keeps help open after a complete pointer click and describes its trigger", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<InfoHint>City coverage explanation</InfoHint>);
    const trigger = screen.getByRole("button", { name: "More info" });
    await user.click(trigger);
    expect(screen.getByRole("tooltip")).toBeVisible();
    expect(trigger).toHaveAccessibleDescription("City coverage explanation");
  });

  it("keeps keyboard help open when the pointer leaves and dismisses on Escape", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<InfoHint>City coverage explanation</InfoHint>);
    const trigger = screen.getByRole("button", { name: "More info" });
    await user.tab();
    await user.hover(trigger);
    await user.unhover(trigger);
    expect(screen.getByRole("tooltip")).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("dismisses hover-only help on Escape and click-away, and can reopen", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<InfoHint>City coverage explanation</InfoHint>);
    const trigger = screen.getByRole("button", { name: "More info" });
    await user.hover(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("tooltip")).toBeNull();
    await user.click(trigger);
    expect(screen.getByRole("tooltip")).toBeVisible();
    await user.click(document.body);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("defaultTargeting", () => {
  it("defaults new drafts to city only and keeps radius for legacy drafts", () => {
    expect(defaultTargeting.cityScope).toBe("city_only");
    expect(targetingToEditor({ location: { radiusKm: 35 } })).toMatchObject({ cityScope: "radius", radiusKm: 35 });
    const draft = targetingFromEditor(manual({ included: [JAIPUR], excluded: [AJMER] }), [], []);
    expect(draft.location).toMatchObject({ cityScope: "city_only", included: [{ key: JAIPUR.key }], excluded: [{ key: AJMER.key }] });
    expect(draft.location).not.toHaveProperty("radiusKm");
    expect(draft.location?.included?.[0]).not.toHaveProperty("radiusKm");
    expect(targetingToEditor(draft).cityScope).toBe("city_only");
  });

  it("starts hands-off so AdBrain decides", () => {
    expect(defaultTargeting).toMatchObject({
      locationMode: "ai",
      ageMode: "ai",
      included: [],
      excluded: [],
    });
  });
});

describe("<TargetingControls> automatic mode", () => {
  it("offers coverage before planning and shows radius only when selected", () => {
    const onChange = vi.fn();
    const { rerender } = render(<TargetingControls value={defaultTargeting} onChange={onChange} brandAreas={["Jaipur"]} />);
    expect(screen.getByRole("radio", { name: "City only" })).toBeChecked();
    expect(screen.queryByRole("slider")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "City + radius" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ cityScope: "radius" }));
    rerender(<TargetingControls value={{ ...defaultTargeting, cityScope: "radius" }} onChange={onChange} brandAreas={["Jaipur"]} />);
    expect(screen.getByRole("slider", { name: "City radius in kilometers" })).toHaveValue("25");
  });

  it("promises to use the Brand Brain service areas", () => {
    view(defaultTargeting);
    expect(screen.getByText(/target your service areas/i)).toBeInTheDocument();
  });

  it("warns when there are no saved areas to target", () => {
    view(defaultTargeting, vi.fn(), []);
    expect(screen.getByText("No service areas selected.")).toBeInTheDocument();
    expect(screen.queryByText(/would run across India/i)).toBeNull();
  });

  it("shows saved campaign areas and exclusions instead of the brand default", () => {
    render(<TargetingControls value={defaultTargeting} onChange={vi.fn()} brandAreas={["Bengaluru"]} plannedAreas={["Jaipur"]} plannedExclusions={["Ajmer"]} />);
    expect(screen.getByText(/People in Jaipur/)).toHaveTextContent("Excluding Ajmer");
    expect(screen.queryByText(/People in Bengaluru/)).toBeNull();
  });

  it("hides the pickers until the owner opts into choosing", () => {
    view(defaultTargeting);
    expect(screen.queryByPlaceholderText(INCLUDE_PLACEHOLDER)).toBeNull();
  });

  it("switches to manual on demand", () => {
    const onChange = view(defaultTargeting);
    fireEvent.click(screen.getAllByRole("button", { name: "Choose myself" })[0]);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ locationMode: "manual" }),
    );
  });

  it("switches back to letting AdBrain decide", () => {
    const onChange = view(manual());
    fireEvent.click(
      screen.getAllByRole("button", { name: /let adbrain decide/i })[0],
    );
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ locationMode: "ai" }),
    );
  });
});

describe("<TargetingControls> location search", () => {
  it("clears obsolete options immediately while the next query is debouncing", async () => {
    const onChange = view(manual());
    await search("jai");
    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(2);
    const input = screen.getByRole("combobox", { name: "Search locations to include" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.change(input, { target: { value: "delhi" } });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input).not.toHaveAttribute("aria-activedescendant");
    expect(input).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Searching locations");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("selects a result with arrows and Enter while retaining input focus", async () => {
    const onChange = view(manual());
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const input = screen.getByRole("combobox", { name: "Search locations to include" });
    await user.click(input);
    await search("jai");
    await user.keyboard("{ArrowUp}");
    const ajmer = screen.getByRole("option", { name: /Ajmer/ });
    expect(ajmer).toHaveAttribute("aria-selected", "true");
    expect(input).toHaveAttribute("aria-activedescendant", ajmer.id);
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: /Jaipur/ })).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ included: [AJMER] }));
    expect(input).toHaveFocus();
    expect(input).toHaveValue("");
    expect(input).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("announces empty results separately from errors", async () => {
    setFetch([]);
    view(manual());
    await search("missing");
    expect(screen.getByRole("status")).toHaveTextContent('No locations found for "missing".');
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("dismisses search feedback when Tab moves to a selected-place chip", async () => {
    setFetch([]);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    view(manual({ included: [JAIPUR] }));
    await user.click(screen.getByRole("combobox", { name: "Search locations to include" }));
    await search("missing");
    await user.tab();
    expect(screen.getByRole("button", { name: "Remove Jaipur" })).toHaveFocus();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("retries the same failed search without changing selected places", async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({
      ok: true, json: async () => ({ results: [AJMER] }),
    });
    const onChange = view(manual({ included: [JAIPUR] }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await user.click(screen.getByRole("combobox", { name: "Search locations to include" }));
    await search("ajm");
    expect(screen.getByRole("status")).toHaveTextContent("Location search is unavailable");
    expect(screen.getByRole("button", { name: "Remove Jaipur" })).toBeInTheDocument();
    await user.tab();
    expect(screen.getByRole("button", { name: "Retry" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(screen.getByRole("combobox", { name: "Search locations to include" })).toHaveFocus();
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("option", { name: /Ajmer/ })).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("treats rejected HTTP responses as failures even when they contain results", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ results: [JAIPUR] }) });
    view(manual());
    await search("jai");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it.each(["Escape", "Tab"])("does not reopen a pending search dismissed with %s", async (key) => {
    let resolveSearch!: (response: unknown) => void;
    global.fetch = vi.fn().mockImplementation(() => new Promise((resolve) => { resolveSearch = resolve; }));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    view(manual());
    const input = screen.getByRole("combobox", { name: "Search locations to include" });
    await user.click(input);
    await search("jai");
    await user.keyboard(`{${key}}`);
    await act(async () => { resolveSearch({ ok: true, json: async () => ({ results: [JAIPUR] }) }); });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("reuses recent successful searches and refetches expired entries", async () => {
    view(manual());
    await search("jai");
    await search("ajm");
    await search("jai");
    expect(global.fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_001);
    await search("ajm");
    await search("jai");
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  it("aborts obsolete searches when typing continues", async () => {
    global.fetch = vi.fn().mockImplementation(() => new Promise(() => {}));
    view(manual());
    await search("jai");
    const signal = vi.mocked(fetch).mock.calls[0][1]!.signal!;
    expect(signal.aborted).toBe(false);
    fireEvent.change(screen.getByPlaceholderText(INCLUDE_PLACEHOLDER), { target: { value: "jaip" } });
    expect(signal.aborted).toBe(true);
  });

  it("ignores a query too short to be meaningful", async () => {
    view(manual());
    await search("j");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("debounces before hitting Meta's geo database", async () => {
    view(manual());
    fireEvent.change(screen.getByPlaceholderText(INCLUDE_PLACEHOLDER), {
      target: { value: "jai" },
    });
    expect(global.fetch).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(400);
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith("/api/meta/geo-search?q=jai", expect.objectContaining({ signal: expect.any(AbortSignal) })),
    );
  });

  it("url-encodes the query", async () => {
    view(manual());
    await search("new delhi");
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/meta/geo-search?q=new%20delhi",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
  });

  it("lists the matches for the owner to pick", async () => {
    view(manual());
    await search("jai");
    expect(await screen.findByText("Jaipur")).toBeInTheDocument();
    expect(screen.getByText("Ajmer")).toBeInTheDocument();
  });

  it("adds the picked place with its real Meta key", async () => {
    const onChange = view(manual());
    await search("jai");
    fireEvent.click(await screen.findByText("Jaipur"));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        included: [expect.objectContaining({ key: "1027633", name: "Jaipur" })],
      }),
    );
  });

  it("closes the dropdown on Escape", async () => {
    view(manual());
    await search("jai");
    expect(await screen.findByText("Jaipur")).toBeInTheDocument();

    // fireEvent flushes React synchronously, so no waitFor race with fake timers.
    fireEvent.keyDown(screen.getByPlaceholderText(INCLUDE_PLACEHOLDER), {
      key: "Escape",
    });
    expect(screen.queryByText("Jaipur")).toBeNull();
  });

  it("closes the dropdown when clicking away", async () => {
    view(manual());
    await search("jai");
    expect(await screen.findByText("Jaipur")).toBeInTheDocument();

    // The outside-click listener is attached in an effect keyed on `open`;
    // let it flush before dispatching, otherwise nothing is listening yet.
    await act(async () => {});
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByText("Jaipur")).toBeNull());
  });

  it("keeps working after a failed lookup", async () => {
    global.fetch = vi
      .fn()
      .mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
    view(manual());
    await search("jai");
    await waitFor(() => expect(global.fetch).toHaveBeenCalled());
    expect(screen.getByPlaceholderText(INCLUDE_PLACEHOLDER)).toBeInTheDocument();
  });
});

describe("<TargetingControls> exclusions", () => {
  it("has a separate picker for places to exclude", async () => {
    const onChange = view(manual());
    await search("ajm", EXCLUDE_PLACEHOLDER);
    fireEvent.click(await screen.findByText("Ajmer"));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        excluded: [expect.objectContaining({ name: "Ajmer" })],
      }),
    );
  });
});

describe("<TargetingControls> chosen places", () => {
  it("removes a place from its chip", () => {
    const onChange = view(manual({ included: [JAIPUR] }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Jaipur" }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ included: [] }),
    );
  });

  it("shows both included and excluded chips", () => {
    view(manual({ included: [JAIPUR], excluded: [AJMER] }));
    expect(screen.getByRole("button", { name: "Remove Jaipur" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Ajmer" })).toBeInTheDocument();
  });
});

describe("<TargetingControls> age", () => {
  it("keeps the age inputs hidden while AdBrain decides", () => {
    view(defaultTargeting);
    expect(screen.queryAllByRole("spinbutton")).toHaveLength(0);
  });

  it("lets the owner set an age range manually", () => {
    const onChange = view(manual({ ageMode: "manual", ageMin: 25, ageMax: 60 }));
    const [min] = screen.getAllByRole("spinbutton");
    fireEvent.change(min, { target: { value: "30" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ ageMin: 30 }));
  });
});
