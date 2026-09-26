export class CheckoutRequestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export function paymentReply(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export async function readPaymentBody(request: Request, maximum = 4096): Promise<Buffer> {
  if (Number(request.headers.get("content-length")) > maximum) throw new CheckoutRequestError(413, "Request body is too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new CheckoutRequestError(400, "Request body is required.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  let expired = false;
  const timer = setTimeout(() => { expired = true; void reader.cancel().catch(() => undefined); }, 5000);
  try {
    for (;;) {
      const next = await reader.read();
      if (expired) throw new CheckoutRequestError(408, "Request body timed out.");
      if (next.done) return Buffer.concat(chunks);
      length += next.value.byteLength;
      if (length > maximum) throw new CheckoutRequestError(413, "Request body is too large.");
      chunks.push(next.value);
    }
  } finally {
    clearTimeout(timer);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function paymentJsonBody(request: Request): Promise<unknown> {
  try { return JSON.parse((await readPaymentBody(request)).toString("utf8")); }
  catch (error) {
    if (error instanceof CheckoutRequestError) throw error;
    throw new CheckoutRequestError(400, "Invalid JSON request.");
  }
}