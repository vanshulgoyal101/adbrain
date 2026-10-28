export class ConnectionAccessError extends Error {
  readonly code: "UNAUTHENTICATED" | "NOT_FOUND" | "FORBIDDEN" | "CONFLICT" | "UNAVAILABLE";
  /** #1217: Meta didn't answer; nothing was saved and the same request can simply be tried again. */
  readonly retryable: boolean;

  constructor(code: ConnectionAccessError["code"], message: string, options: { retryable?: boolean } = {}) {
    super(message);
    this.name = "ConnectionAccessError";
    this.code = code;
    this.retryable = options.retryable ?? false;
  }
}
