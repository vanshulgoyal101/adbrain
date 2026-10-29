// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MediaRightsConsent, mediaConsentComplete } from "@/components/media-rights-consent";
import { MEDIA_MUSIC_NOTE, MEDIA_PEOPLE_TEXT, MEDIA_RIGHTS_TEXT } from "@/lib/media/consent";

describe("<MediaRightsConsent> (#784)", () => {
  it("shows the rights tick, the people tick for a clinic, and the music note for a video", () => {
    const onChange = vi.fn();
    render(<MediaRightsConsent vertical="dental clinic" value={{ rights: false, people: false }} onChange={onChange} hasVideo />);
    fireEvent.click(screen.getByLabelText(MEDIA_RIGHTS_TEXT));
    expect(onChange).toHaveBeenLastCalledWith({ rights: true, people: false });
    fireEvent.click(screen.getByLabelText(MEDIA_PEOPLE_TEXT));
    expect(onChange).toHaveBeenLastCalledWith({ rights: false, people: true });
    expect(screen.getByText(MEDIA_MUSIC_NOTE)).toBeInTheDocument();
  });

  it("has no people tick for solar and no music note for photos", () => {
    render(<MediaRightsConsent vertical="solar energy" value={{ rights: false, people: false }} onChange={vi.fn()} />);
    expect(screen.queryByLabelText(MEDIA_PEOPLE_TEXT)).toBeNull();
    expect(screen.queryByText(MEDIA_MUSIC_NOTE)).toBeNull();
    expect(mediaConsentComplete({ rights: true, people: false }, "solar energy")).toBe(true);
    expect(mediaConsentComplete({ rights: true, people: false }, "dental clinic")).toBe(false);
  });
});
