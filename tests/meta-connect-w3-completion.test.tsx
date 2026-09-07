// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MetaConnectCompletion } from "@/components/meta-connect/meta-connect-completion";
import { connectedAttemptForActivation } from "./fixtures/meta-connect-w3";

describe("MetaConnectCompletion", () => {
  it("offers an owned campaign continuation when there is no opener", () => {
    vi.stubGlobal("open", null);
    render(<MetaConnectCompletion attempt={connectedAttemptForActivation} />);

    expect(screen.getByRole("link", { name: /continue in adbrain/i })).toHaveAttribute(
      "href",
      "/campaigns",
    );
  });
});