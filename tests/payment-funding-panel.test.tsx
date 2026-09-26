// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ManagedBilling } from "@/components/managed-billing";
import { META_FUNDING_METHODS } from "@/lib/payments/meta-funding";

const connected = { adAccountId: "act_123", ready: true, expired: false, pending: false };

describe("managed billing settings", () => {
  it("shows planned economics without presenting an enabled payment product", () => {
    render(<ManagedBilling connection={connected} />);
    expect(screen.getByRole("region", { name: "Managed billing" })).toBeInTheDocument();
    expect(screen.getByText("Not enabled")).toBeInTheDocument();
    expect(screen.getByText("20%")).toBeInTheDocument();
    expect(screen.getByText("80%")).toBeInTheDocument();
    expect(screen.getByText("Current operator")).toBeInTheDocument();
    expect(screen.getByText("Vanshul Goyal")).toBeInTheDocument();
    expect(screen.getByText("Future account ownership")).toBeInTheDocument();
    expect(screen.getByText("Solaride arrangement not yet formalized")).toBeInTheDocument();
    expect(screen.queryByText("Solaride Energy")).not.toBeInTheDocument();
    expect(screen.getByText("act_123")).toBeInTheDocument();
    expect(screen.getByText("Not verified")).toBeInTheDocument();
    expect(screen.getByText(/No funding method selected/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it.each([
    [null, "Temporarily unavailable"],
    [{ ...connected, ready: false, expired: true }, "Reconnect required"],
    [{ ...connected, ready: false, pending: true, adAccountId: null }, "Account selection required"],
    [{ ...connected, ready: false, adAccountId: null }, "Not connected"],
    [connected, "Connected"],
  ])("keeps funding unverified for connection state %j", (connection, label) => {
    render(<ManagedBilling connection={connection} />);
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText("Not verified")).toBeInTheDocument();
    if (!connection) {
      expect(screen.getByText("Unavailable")).toBeInTheDocument();
      expect(screen.queryByText("Not selected")).not.toBeInTheDocument();
    } else if (!connection.adAccountId) {
      expect(screen.getByText("Not selected")).toBeInTheDocument();
    }
  });

  it("uses official requirements links without exposing a payment execution action", () => {
    const { container } = render(<ManagedBilling connection={connected} />);
    const options = container.querySelectorAll("details");
    expect(options).toHaveLength(3);
    for (const option of options) option.open = true;
    for (const method of META_FUNDING_METHODS) {
      const link = screen.getByRole("link", { name: `Meta requirements for ${method.name}` });
      expect(link).toHaveAttribute("href", method.documentationUrl);
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
    expect(screen.getByText(/Prepaid accounts have no Meta account spending limit/)).toBeInTheDocument();
    expect(screen.getByText(/do not transfer exactly 80%/)).toBeInTheDocument();
  });
});