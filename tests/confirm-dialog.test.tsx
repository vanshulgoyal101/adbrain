// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useConfirm, type ConfirmOptions } from "@/components/ui/confirm-dialog";

function Harness({ options, onResult }: { options: ConfirmOptions; onResult: (value: boolean) => void }) {
  const [confirm, dialog] = useConfirm();
  return <><button type="button" onClick={() => void confirm(options).then(onResult)}>Delete it</button>{dialog}</>;
}

const options: ConfirmOptions = { title: "Delete this ad?", description: "This can't be undone.", confirmLabel: "Delete ad", tone: "danger" };

describe("useConfirm (#403 S6)", () => {
  it("resolves true only on the confirm button, and names the dialog by its title", async () => {
    const results: boolean[] = [];
    render(<Harness options={options} onResult={(value) => results.push(value)} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete it" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this ad?" });
    expect(dialog).toHaveAccessibleDescription("This can't be undone.");
    fireEvent.click(screen.getByRole("button", { name: "Delete ad" }));
    await waitFor(() => expect(results).toEqual([true]));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("returns focus to the button that asked, like the native confirm did", async () => {
    render(<Harness options={options} onResult={() => {}} />);
    const opener = screen.getByRole("button", { name: "Delete it" });
    opener.focus();
    fireEvent.click(opener);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it.each([
    ["Cancel", () => fireEvent.click(screen.getByRole("button", { name: "Cancel" }))],
    ["Escape", () => fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })],
  ])("resolves false on %s", async (_name, dismiss) => {
    const results: boolean[] = [];
    render(<Harness options={options} onResult={(value) => results.push(value)} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete it" }));
    await screen.findByRole("dialog");
    act(dismiss);
    await waitFor(() => expect(results).toEqual([false]));
  });
});
