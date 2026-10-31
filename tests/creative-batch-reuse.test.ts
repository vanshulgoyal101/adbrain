import { describe, expect, it } from "vitest";
import { batchPictures, freeBusyFailure } from "@/lib/creative/batch-reuse";
import type { GeneratedVariant } from "@/lib/creative/generate";
import run4 from "./core/fixtures/create/cedar-ridge-run4.json";
import { FreeImageBusyError, FreeImageDailyLimitError } from "@/lib/imageGen/types";

const ad = (imageUrl: string) => ({ imageUrl, imageUsage: { provider: "pollinations", model: "flux", estimatedCostUsd: 0 } }) as GeneratedVariant;
const busy = (cause: unknown) => ({ cause, usage: [], imageAttempts: [], concept: run4.angles[2].concept });

// #2378: which failures borrow a sibling's picture, and which picture they get.
describe("batch picture reuse", () => {
  it("borrows only for a free picture that busied out (or hit the free daily limit)", () => {
    expect(freeBusyFailure(busy(new FreeImageBusyError()))).toBe(true);
    expect(freeBusyFailure(busy(new FreeImageDailyLimitError()))).toBe(true);
    expect(freeBusyFailure(busy(new Error("402 credit")))).toBe(false);
    expect(freeBusyFailure({ ...busy(new FreeImageBusyError()), concept: undefined })).toBe(false);
    expect(freeBusyFailure(new FreeImageBusyError())).toBe(false);
  });

  it("gives two borrowers different pictures when two were made", async () => {
    const pictures = batchPictures(4);
    pictures.settle(0, ad("a"));
    pictures.settle(1, ad("b"));
    pictures.settle(2);
    pictures.settle(3);
    const input = { brand: run4.brand, angle: { id: "offer", name: "Offer" } } as never;
    const borrowed = await Promise.all([2, 3].map((index) => pictures.borrow(index, input, busy(new FreeImageBusyError()))));
    expect(borrowed.map((v) => v.imageUrl).sort()).toEqual(["a", "b"]);
  });

  it("rethrows when the batch made no picture", async () => {
    const pictures = batchPictures(2);
    pictures.settle(0);
    const failure = busy(new FreeImageBusyError());
    await expect(pictures.borrow(1, {} as never, failure)).rejects.toBe(failure);
  });
});
