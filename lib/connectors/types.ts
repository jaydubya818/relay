import type { CapabilityName } from "@/lib/types";

export type ConnectorHealth = { ok: boolean; externalAccountId?: string; displayName?: string; message?: string };

export interface ConnectorProvider {
  readonly provider: string;
  capabilities(): CapabilityName[];
  health(secret: string): Promise<ConnectorHealth>;
  execute(secret: string, operation: string, input: Record<string, unknown>): Promise<unknown>;
}
