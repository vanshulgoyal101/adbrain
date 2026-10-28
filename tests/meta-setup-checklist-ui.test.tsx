// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
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

  it("puts the row to fix first and counts it; what's done is a short list (#847)", () => {
    render(<MetaSetupChecklist rows={setupChecklist(reads, { adAccountId: "act_42" })} />);
    expect(screen.getByText(/^1 thing to fix in Meta before you launch/)).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Payment method");
    expect(within(screen.getByRole("list", { name: "Already set" })).getAllByRole("listitem")).toHaveLength(4);
    expect(screen.getByText(/\(Solaride\)/)).toBeInTheDocument();
  });

  it("is one line when everything is set, with the checks behind a disclosure (#847)", () => {
    render(<MetaSetupChecklist rows={setupChecklist({ ...reads, paymentMethod: true }, { adAccountId: "act_42" })} />);
    expect(screen.getByText(/^All 5 set\./)).toBeInTheDocument();
    expect(screen.getByText("See what AdBrain checked").closest("details")).not.toHaveAttribute("open");
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByText(": needs action")).toBeNull();
  });

  it("says so plainly when Meta can't be read", () => {
    render(<MetaSetupChecklist rows={null} />);
    expect(screen.getByText(/couldn't read your Meta setup/)).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
