// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

// #403 S6: one Dialog for every modal (Radix): named, traps focus, Escape and outside click close,
// focus returns to the opener, and the page behind can't scroll.
function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Review before approval</DialogTitle>
          <DialogDescription>Meta feed preview</DialogDescription>
          <button>Approve</button>
          <DialogClose aria-label="Close preview" />
        </DialogContent>
      </Dialog>
    </>
  );
}

describe("<Dialog> (#403 S6)", () => {
  it("opens named, keeps focus inside, closes on Escape and returns focus", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Review before approval" });
    expect(dialog).toHaveAccessibleDescription("Meta feed preview");
    // Radix marks everything outside the dialog aria-hidden (instead of aria-modal).
    expect(opener.closest('[aria-hidden="true"]')).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    expect(document.body).toHaveAttribute("data-scroll-locked");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("closes with the close button, which has a 44 px target", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    const close = screen.getByRole("button", { name: "Close preview" });
    expect(close.className).toMatch(/\bsize-11\b|\bh-11\b/);
    await user.click(close);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
