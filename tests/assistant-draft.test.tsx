// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AdAssistant } from "@/components/ad-assistant";
import type { Business } from "@/lib/types";

const business = { id: "biz-1", name: "Cedar Ridge Chiro" } as Business;

describe("<AdAssistant> draft persistence", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => sessionStorage.clear());

  it("frames creation as a brand-grounded campaign brief", async () => {
    const user = userEvent.setup();
    render(<AdAssistant business={business} />);

    expect(screen.getByText("Grounded in Cedar Ridge Chiro")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Creation stages" })).toBeInTheDocument();
    expect(screen.queryByText("Brief preview")).toBeNull();

    const goal = screen.getByRole("textbox", { name: "Campaign goal" });
    const start = screen.getByRole("button", { name: /start creating/i });
    expect(start).toBeDisabled();

    await user.type(goal, "Bring local families in for a spring checkup");
    expect(goal).toHaveValue("Bring local families in for a spring checkup");
    expect(start).toBeEnabled();
  });

  it("offers grounded starting goals without fabricating an offer", async () => {
    const user = userEvent.setup();
    render(<AdAssistant business={business} />);
    await user.click(screen.getByRole("button", { name: "Promote an existing offer" }));
    expect(screen.getByRole("textbox", { name: "Campaign goal" })).toHaveValue("Create a campaign around an offer already saved in my Brand Brain. Ask me to confirm the offer details.");
    expect(screen.queryByText("Free consult")).toBeNull();
  });

  it("restores a typed goal after navigating away and back", async () => {
    const user = userEvent.setup();
    const first = render(<AdAssistant business={business} />);
    const box = screen.getByRole("textbox");
    await user.type(box, "Weekend offer for new patients");

    // Leaving the tab unmounts the component.
    first.unmount();
    render(<AdAssistant business={business} />);

    expect(
      await screen.findByDisplayValue("Weekend offer for new patients"),
    ).toBeInTheDocument();
  });

  it("keeps drafts separate per business", async () => {
    const user = userEvent.setup();
    const first = render(<AdAssistant business={business} />);
    await user.type(screen.getByRole("textbox"), "Cedar Ridge idea");
    first.unmount();

    render(
      <AdAssistant business={{ ...business, id: "biz-2" } as Business} />,
    );
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("starts clean when there is no draft", () => {
    render(<AdAssistant business={business} />);
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("ignores a corrupted draft rather than crashing", () => {
    sessionStorage.setItem(`adbrain:assistant:${business.id}`, "{not json");
    render(<AdAssistant business={business} />);
    expect(screen.getByRole("textbox")).toHaveValue("");
  });
});
