export type RelayRuntimeProduct = "claude" | "codex" | "cursor" | "openclaw" | "myeve" | "custom";

export interface RelayV2ClientOptions {
  baseUrl: string;
  accountId: string;
  credential: string;
  leaseToken: string;
  workloadId: string;
  audience?: string;
  runtimeProduct: RelayRuntimeProduct;
  fetch?: typeof globalThis.fetch;
}

export interface RelayRuntimeActionResult {
  schemaVersion: "relay.runtime-action-result.v1";
  commandId: string;
  taskId: string;
  actionIntentId: string;
  state: "QUEUED" | "PROCESSING" | "COMPLETED" | "CANCELLED" | "DEAD_LETTERED";
  durable: true;
  idempotentReplay: boolean;
}

export class RelayV2Client {
  readonly #options: RelayV2ClientOptions;

  constructor(options: RelayV2ClientOptions) {
    this.#options = { ...options, baseUrl: options.baseUrl.replace(/\/$/, "") };
  }

  async submitAction(action: unknown, idempotencyKey: string): Promise<RelayRuntimeActionResult> {
    const response = await (this.#options.fetch ?? globalThis.fetch)(`${this.#options.baseUrl}/api/v2/runtime/actions`, {
      method: "POST",
      headers: this.#headers({ "content-type": "application/json", "idempotency-key": idempotencyKey }),
      body: JSON.stringify({ action }),
    });
    return await this.#result(response);
  }

  async actionStatus(taskId: string, commandId: string): Promise<RelayRuntimeActionResult> {
    const query = new URLSearchParams({ taskId });
    const response = await (this.#options.fetch ?? globalThis.fetch)(`${this.#options.baseUrl}/api/v2/runtime/actions/${encodeURIComponent(commandId)}?${query}`, {
      headers: this.#headers(),
    });
    return await this.#result(response);
  }

  #headers(extra: Record<string, string> = {}) {
    return {
      authorization: `Bearer ${this.#options.credential}`,
      "x-relay-account-id": this.#options.accountId,
      "x-relay-lease": this.#options.leaseToken,
      "x-relay-workload-id": this.#options.workloadId,
      "x-relay-audience": this.#options.audience ?? "relay-api",
      "x-relay-runtime-product": this.#options.runtimeProduct,
      ...extra,
    };
  }

  async #result(response: Response): Promise<RelayRuntimeActionResult> {
    const body = await response.json();
    if (!response.ok) throw new Error(`Relay request failed (${response.status}): ${JSON.stringify(body)}`);
    return body as RelayRuntimeActionResult;
  }
}
