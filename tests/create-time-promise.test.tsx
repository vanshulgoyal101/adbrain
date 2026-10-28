// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyCreateLine, CREATE_PROMISE_MS, CreateProgress, type LiveAd } from "@/components/create-progress";

// #760 item 2: the time promise is the measured p90 (#713), and it stops promising once that has passed.
describe("Create's time promise", () => {
  afterEach(() => vi.useRealTimers());

  it("promises the measured p90, then says honestly that it's taking longer", () => {
    vi.useFakeTimers();
    render(<CreateProgress ads={[{ stage: "writing" }, { stage: "writing" }, { stage: "writing" }]} renderReady={() => null} />);
    expect(screen.getByText(/0:00 elapsed · usually under 1½ minutes/)).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(CREATE_PROMISE_MS - 1000));
    expect(screen.getByText(/1:29 elapsed · usually under 1½ minutes/)).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1000));
    expect(screen.getByText(/1:30 elapsed · taking longer than usual, still going/)).toBeInTheDocument();
    expect(screen.queryByText(/usually under/)).not.toBeInTheDocument();
  });

  // #1542: while the paid picture key is out, pictures come from the slower free provider; say so, don't wait silently.
  it("says pictures are slower today once the stream reports a free-picture fallback, until those ads finish", () => {
    let ads: LiveAd[] = [{ stage: "starting" }, { stage: "starting" }, { stage: "starting" }];
    for (const [angleId, stage] of [["a", "image"], ["b", "image"], ["c", "checking"]] as const)
      ads = applyCreateLine(ads, { type: "progress", angleId, angleName: angleId, stage, at: 0 });
    const { rerender } = render(<CreateProgress ads={ads} renderReady={() => null} />);
    expect(screen.queryByText(/Pictures are taking longer today/)).not.toBeInTheDocument();

    ads = applyCreateLine(ads, { type: "progress", angleId: "a", angleName: "a", stage: "image", at: 1, slowPictures: true });
    rerender(<CreateProgress ads={ads} renderReady={() => null} />);
    expect(screen.getByRole("status")).toHaveTextContent("Pictures are taking longer today. Your 3 ads are still coming.");
    expect(screen.getByText(/elapsed · still going/)).toBeInTheDocument();
    expect(screen.queryByText(/usually under/)).not.toBeInTheDocument();

    // A later plain progress line for the same ad keeps the flag.
    ads = applyCreateLine(ads, { type: "progress", angleId: "a", angleName: "a", stage: "image", at: 2 });
    ads = applyCreateLine(ads, { type: "progress", angleId: "b", angleName: "b", stage: "ready", at: 3 });
    ads = applyCreateLine(ads, { type: "progress", angleId: "c", angleName: "c", stage: "failed", at: 3 });
    rerender(<CreateProgress ads={ads} renderReady={() => null} />);
    expect(screen.getByRole("status")).toHaveTextContent("Pictures are taking longer today. Your last ad is still coming.");

    ads = applyCreateLine(ads, { type: "progress", angleId: "a", angleName: "a", stage: "ready", at: 4 });
    rerender(<CreateProgress ads={ads} renderReady={() => null} />);
    expect(screen.queryByText(/Pictures are taking longer today/)).not.toBeInTheDocument();
  });
});
