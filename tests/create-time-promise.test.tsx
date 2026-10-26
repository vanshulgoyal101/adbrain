// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CREATE_PROMISE_MS, CreateProgress } from "@/components/create-progress";

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
});
