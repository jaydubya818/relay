export type RelayErrorCode =
  | "CAPABILITY_DENIED"
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
  ) {
    super(message);
    this.name = "RelayError";
  }

  toJSON() {
    return { code: this.code, ...(this.capability ? { capability: this.capability } : {}), message: this.message };
  }
}
