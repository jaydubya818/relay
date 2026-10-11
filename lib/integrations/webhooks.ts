import type { Composio } from "@composio/core";
import { canonicalHash } from "@/lib/v2/contracts";
import { IntegrationError } from "./contracts";

/** The eventual ingress must implement this with a durable, account-scoped unique key.
 * Claim and canonical audit append must commit together; no in-memory replay cache. */
export interface IntegrationEventStore {
  recordVerifiedEvent(input: { webhookId: string; payloadHash: string; payload: unknown }): Promise<"RECORDED" | "DUPLICATE">;
}

/** Offline-verifiable ingestion preparation. No HTTP route or trigger registration is installed. */
export async function verifyComposioEvent(sdk: Pick<Composio, "triggers">, input: {
  body: string; id: string; timestamp: string; signature: string; secret: string;
}) {
  if (Buffer.byteLength(input.body) > 256 * 1024 || input.id.length > 255 || !/^\d{10}$/.test(input.timestamp)) throw new IntegrationError("INVALID_EVENT");
  try {
    const verified = await sdk.triggers.verifyWebhook({ payload: input.body, id: input.id,
      timestamp: input.timestamp, signature: input.signature, secret: input.secret, tolerance: 300 });
    // Payload remains internal until authoritative connection resolution and projection.
    return { webhookId: input.id, payloadHash: canonicalHash(verified.rawPayload), payload: verified.payload,
      authority: "NONE" as const };
  } catch { throw new IntegrationError("INVALID_EVENT_SIGNATURE"); }
}
