export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  /** Same key for the same email, so a retry after a lost response never sends twice. */
  idempotencyKey: string;
}

/** `retryable` is true for outages and rate limits, false for a message the provider rejected. */
export class EmailSendError extends Error {
  constructor(readonly retryable: boolean, readonly code: string) {
    super(`Email send failed: ${code}`);
    this.name = "EmailSendError";
  }
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

export function createResendProvider(options: { apiKey: string; from: string; fetcher?: typeof fetch }): EmailProvider {
  const fetcher = options.fetcher ?? fetch;
  return {
    async send(message) {
      let response: Response;
      try {
        response = await fetcher("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${options.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": message.idempotencyKey,
          },
          body: JSON.stringify({
            from: options.from, to: [message.to], subject: message.subject,
            html: message.html, text: message.text, headers: message.headers,
          }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new EmailSendError(true, "network");
      }
      if (response.ok) return;
      throw new EmailSendError(response.status === 429 || response.status >= 500, `http_${response.status}`);
    },
  };
}
