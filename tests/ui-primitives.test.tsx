// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InfoHint } from "@/components/ui/info-hint";
import { Input, Label, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Spinner } from "@/components/ui/spinner";

describe("<Button>", () => {
  it("renders its label and fires onClick", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire when disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn).toBeDisabled();
    await userEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("applies the variant and size styles", () => {
    const { rerender } = render(<Button variant="danger">Delete</Button>);
    expect(screen.getByRole("button")).toHaveClass("bg-red-600");
    rerender(
      <Button variant="outline" size="sm">
        Cancel
      </Button>,
    );
    const btn = screen.getByRole("button");
    expect(btn).toHaveClass("border-slate-300");
    expect(btn).toHaveClass("h-8");
  });

  it("keeps caller classes alongside the variant", () => {
    render(<Button className="w-full">Go</Button>);
    expect(screen.getByRole("button")).toHaveClass("w-full");
  });
});

describe("<Alert>", () => {
  it("marks errors as an alert for screen readers", () => {
    render(<Alert variant="error">Something broke</Alert>);
    expect(screen.getByRole("alert")).toHaveTextContent("Something broke");
  });

  it("does not use the alert role for non-error variants", () => {
    render(<Alert variant="info">Just so you know</Alert>);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Just so you know")).toBeInTheDocument();
  });

  it("styles each variant distinctly", () => {
    const { rerender, container } = render(<Alert variant="warning">w</Alert>);
    expect(container.firstChild).toHaveClass("bg-amber-50");
    rerender(<Alert variant="success">s</Alert>);
    expect(container.firstChild).toHaveClass("bg-blue-50");
  });
});

describe("<Card>", () => {
  it("composes header, title and content", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Spend guardrails</CardTitle>
        </CardHeader>
        <CardContent>Body copy</CardContent>
      </Card>,
    );
    expect(
      screen.getByRole("heading", { name: "Spend guardrails" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Body copy")).toBeInTheDocument();
  });
});

describe("<PageHeader>", () => {
  it("renders product context, title, description, and actions", () => {
    render(
      <PageHeader
        eyebrow="Launch"
        title="Campaigns"
        description="Review before anything spends."
        actions={<Button>New campaign</Button>}
      />,
    );
    expect(screen.getByText("Launch")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Campaigns" })).toBeInTheDocument();
    expect(screen.getByText("Review before anything spends.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New campaign" })).toBeInTheDocument();
  });
});

describe("form primitives", () => {
  it("associates a label with its input and accepts typing", async () => {
    render(
      <>
        <Label htmlFor="cap">Weekly cap</Label>
        <Input id="cap" placeholder="No cap" />
      </>,
    );
    const input = screen.getByLabelText("Weekly cap");
    await userEvent.type(input, "7000");
    expect(input).toHaveValue("7000");
  });

  it("forwards a ref to the underlying input", () => {
    const ref = { current: null as HTMLInputElement | null };
    render(<Input ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it("renders a textarea that accepts multiline text", async () => {
    render(<Textarea aria-label="Notes" />);
    const area = screen.getByLabelText("Notes");
    await userEvent.type(area, "line one{enter}line two");
    expect(area).toHaveValue("line one\nline two");
  });

  it("respects the disabled state", () => {
    render(<Input aria-label="Locked" disabled />);
    expect(screen.getByLabelText("Locked")).toBeDisabled();
  });
});

describe("<Spinner>", () => {
  it("animates and merges custom classes", () => {
    const { container } = render(<Spinner className="h-8 w-8" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveClass("animate-spin");
    expect(svg).toHaveClass("h-8");
  });
});

describe("<InfoHint>", () => {
  it("hides its explanation until asked", () => {
    render(<InfoHint>Radius around each city.</InfoHint>);
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(screen.getByRole("button", { name: "More info" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("reveals the explanation on hover", async () => {
    render(<InfoHint>Radius around each city.</InfoHint>);
    await userEvent.hover(screen.getByRole("button", { name: "More info" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Radius around each city.",
    );
  });

  it("opens on keyboard focus so it is not mouse-only", async () => {
    render(<InfoHint label="Explain budget">Daily spend.</InfoHint>);
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Explain budget" })).toHaveFocus();
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("opens on tap where there is no hover (touch)", () => {
    render(<InfoHint>Details</InfoHint>);
    // A touch tap fires click without a preceding mouseenter.
    fireEvent.click(screen.getByRole("button", { name: "More info" }));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
  });

  it("closes again when the pointer leaves", async () => {
    render(<InfoHint>Details</InfoHint>);
    const trigger = screen.getByRole("button", { name: "More info" });
    await userEvent.hover(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    await userEvent.unhover(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
