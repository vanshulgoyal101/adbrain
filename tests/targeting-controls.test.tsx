// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TargetingControls,
  defaultTargeting,
  type TargetingValue,
} from "@/components/targeting-controls";

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
  await vi.advanceTimersByTimeAsync(400);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  setFetch([JAIPUR, AJMER]);
});

afterEach(() => vi.useRealTimers());

describe("defaultTargeting", () => {
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
  it("promises to use the Brand Brain service areas", () => {
    view(defaultTargeting);
    expect(screen.getByText(/target your service areas/i)).toBeInTheDocument();
  });

  it("warns when there are no saved areas to target", () => {
    view(defaultTargeting, vi.fn(), []);
    expect(screen.getByText(/would run across India/i)).toBeInTheDocument();
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
      expect(global.fetch).toHaveBeenCalledWith("/api/meta/geo-search?q=jai"),
    );
  });

  it("url-encodes the query", async () => {
    view(manual());
    await search("new delhi");
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/meta/geo-search?q=new%20delhi",
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
