import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readCreateResponse } from "@/components/create-progress";
import { CREATE_HEARTBEAT_MS, CREATE_IDLE_MS, CREATE_IDLE_NO_HEARTBEAT_MS } from "@/lib/creative/stream";

// #666: a Create stream that goes silent must end in the saved-results recovery, never spin forever.
function liveStream() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
  const response = new Response(body, { headers: { "Content-Type": "application/x-ndjson" } });
  const send = (text: string) => controller.enqueue(new TextEncoder().encode(text));
  return { response, send };
}

const progress = `${JSON.stringify({ type: "progress", angleId: "pain", angleName: "Pain point", stage: "writing", at: 0 })}\n`;
const result = `${JSON.stringify({ type: "result", status: 200, body: { creatives: [] } })}\n`;

describe("readCreateResponse idle limits (#666)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("gives up after a minute of silence once the route has sent a heartbeat", async () => {
    const { response, send } = liveStream();
    const reading = readCreateResponse(response, () => {});
    const outcome = reading.then(() => "result", (error: Error) => error.message);
    send(progress);
    send("\n");
    await vi.advanceTimersByTimeAsync(CREATE_IDLE_MS - 1);
    send("\n");
    await vi.advanceTimersByTimeAsync(CREATE_IDLE_MS + 1);
    expect(await outcome).toBe("We lost contact while making your ads. Open Studio to see what was saved.");
  });

  it("stays open through a slow run while heartbeats keep arriving, then returns the result", async () => {
    const { response, send } = liveStream();
    const lines: unknown[] = [];
    const reading = readCreateResponse(response, (line) => lines.push(line));
    send(progress);
    for (let t = 0; t < 280_000; t += CREATE_HEARTBEAT_MS) {
      await vi.advanceTimersByTimeAsync(CREATE_HEARTBEAT_MS);
      send("\n");
    }
    send(result);
    await expect(reading).resolves.toEqual({ status: 200, data: { creatives: [] } });
    expect(lines).toHaveLength(1);
  });

  it("waits past the route's deadline for a stream that never sent a heartbeat", async () => {
    const { response, send } = liveStream();
    const reading = readCreateResponse(response, () => {});
    const outcome = reading.then(() => "result", (error: Error) => error.message);
    send(progress);
    // Production's longest silent gap without heartbeats was ~103 s (a Pollinations image).
    await vi.advanceTimersByTimeAsync(120_000);
    send(result);
    expect(await outcome).toBe("result");

    const silent = liveStream();
    const timedOut = readCreateResponse(silent.response, () => {}).then(() => "result", (error: Error) => error.message);
    silent.send(progress);
    await vi.advanceTimersByTimeAsync(CREATE_IDLE_NO_HEARTBEAT_MS + 1);
    expect(await timedOut).toBe("We lost contact while making your ads. Open Studio to see what was saved.");
  });
});
