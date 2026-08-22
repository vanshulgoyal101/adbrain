// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadBlob } from "@/lib/download";

describe("downloadBlob", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // jsdom doesn't implement the object-URL APIs — stub them.
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi
      .fn()
      .mockReturnValue("blob:mock-url");
    (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL =
      vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("attaches the anchor to the DOM, clicks it, then detaches it", () => {
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        // The anchor must be in the document when clicked (Firefox requirement).
        expect(document.body.contains(this)).toBe(true);
        expect(this.download).toBe("ad-pack.zip");
        expect(this.getAttribute("href")).toBe("blob:mock-url");
      });

    downloadBlob(new Blob(["data"]), "ad-pack.zip");

    expect(clickSpy).toHaveBeenCalledTimes(1);
    // Anchor is removed synchronously after the click.
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("defers revoking the object URL until after the download can start", () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const revoke = URL.revokeObjectURL as unknown as ReturnType<typeof vi.fn>;

    downloadBlob(new Blob(["data"]), "file.zip");

    // Revoking synchronously would abort the download — it must be deferred.
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:mock-url");
  });
});
