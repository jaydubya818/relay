export type RelayErrorCode =
  | "CAPABILITY_DENIED"
  | "CAPABILITY_PENDING"
  | "CAPABILITY_UNAVAILABLE"
  | "INVALID_CREDENTIAL"
  | "REVOKED_CREDENTIAL"
  | "CONNECTION_REQUIRED"
  | "PROVIDER_ERROR"
  | "RATE_LIMITED"
  | "INVALID_INPUT"
  | "INTERNAL_ERROR";

export class RelayError extends Error {
  constructor(
    public readonly code: RelayErrorCode,
    message: string,
    public readonly capability?: string,
    public readonly status = 400,
    public readonly retryAfterSeconds?: number,
    public readonly reason?: string,
  ) {
    super(message);
    this.name = "RelayError";
  }

  toJSON() {
    return {
      code: this.code,
      ...(this.capability ? { capability: this.capability } : {}),
      ...(this.reason ? { reason: this.reason } : {}),
      ...(this.retryAfterSeconds !== undefined ? { retryAfter: this.retryAfterSeconds } : {}),
      message: this.message,
    };
  }
}
