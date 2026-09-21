import { z } from "zod";
import { RelayError } from "@/lib/errors";
import { requireRuntimeActionsEnabled } from "@/lib/v2/deployment";
import { requireV2PlatformBindings } from "@/lib/v2/platform-bindings";
import { acknowledgeFederationResult, getFederationRequest, pollFederationInbox, respondToFederationRequest, submitFederationRequest } from "./service";
import { discoverFederationAgents } from "./discovery";
import type { FederationBindings } from "./transport";

export function federationBindings(): FederationBindings {
  requireRuntimeActionsEnabled();
  const bindings = requireV2PlatformBindings();
  if (process.env.RELAY_FEDERATION_ENABLED !== "true" || !bindings.federation) throw new RelayError("CONNECTION_REQUIRED", "Federation is not enabled and configured for this deployment.", undefined, 503);
  return { signer: bindings.signer, ...bindings.federation };
}
export function bearer(request: Request) {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) throw new RelayError("INVALID_CREDENTIAL", "Agent bearer credential required.", undefined, 401);
  return value.slice(7);
}
export async function boundedBody(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 128 * 1024) throw new RelayError("INVALID_INPUT", "Request too large.", undefined, 413);
  const reader = request.body?.getReader();
  if (!reader) throw new RelayError("INVALID_INPUT", "JSON body required.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 128 * 1024) { await reader.cancel(); throw new RelayError("INVALID_INPUT", "Request too large.", undefined, 413); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new RelayError("INVALID_INPUT", "Invalid JSON."); }
}
const commandSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("submit"), input: z.unknown() }).strict(),
  z.object({ operation: z.literal("poll") }).strict(),
  z.object({ operation: z.literal("get"), requestId: z.string().max(255) }).strict(),
  z.object({ operation: z.literal("respond"), requestId: z.string().max(255), input: z.unknown() }).strict(),
  z.object({ operation: z.literal("acknowledge"), requestId: z.string().max(255) }).strict(),
  z.object({ operation: z.literal("discover"), input: z.unknown() }).strict(),
]);
export async function executeFederationCommand(secret: string, value: unknown, bindings: FederationBindings) {
  const command = commandSchema.parse(value);
  switch (command.operation) {
    case "submit": return submitFederationRequest(secret, command.input, bindings);
    case "poll": return pollFederationInbox(secret, bindings);
    case "get": return getFederationRequest(secret, command.requestId, bindings);
    case "respond": return respondToFederationRequest(secret, command.requestId, command.input, bindings);
    case "acknowledge": return acknowledgeFederationResult(secret, command.requestId);
    case "discover": return discoverFederationAgents(secret, command.input);
  }
}
