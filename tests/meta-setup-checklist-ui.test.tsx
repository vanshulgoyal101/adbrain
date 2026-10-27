// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MetaSetupChecklist } from "@/components/meta-setup-checklist";
import { setupChecklist } from "@/lib/meta/setup-checklist";

const reads = { portfolio: { id: "1", name: "Solaride" }, accountActive: true, currency: "INR", paymentMethod: false, pageListed: true, whatsapp: true };

describe("Meta setup checklist (#1016)", () => {
  it("ticks what's done and gives the missing row one Meta link in a new tab, with a Hindi line", () => {
    render(<MetaSetupChecklist rows={setupChecklist(reads, { adAccountId: "act_42" })} />);
    expect(screen.getByRole("heading", { name: "Ready to launch on Meta" })).toBeInTheDocument();
    expect(screen.getByText("Business portfolio")).toBeInTheDocument();
    expect(screen.getAllByText(": done", { selector: "span" })).toHaveLength(4);
    expect(screen.getAllByText(": needs action", { selector: "span" })).toHaveLength(1);
    const link = screen.getByRole("link", { name: /Add a card or UPI/ });
    expect(link).toHaveAttribute("href", "https://business.facebook.com/billing_hub/payment_settings/?asset_id=42");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(document.querySelector('[lang="hi"]')?.textContent).toMatch(/UPI/);
  });

  it("says so plainly when Meta can't be read", () => {
    render(<MetaSetupChecklist rows={null} />);
    expect(screen.getByText(/couldn't read your Meta setup/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
