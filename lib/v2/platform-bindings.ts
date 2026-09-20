import { RelayError } from "@/lib/errors";
import type { AuditSigner, KeyWrapper } from "@/lib/v2/evidence/crypto";
import type { DeveloperAccessTokenVerifier } from "@/lib/v2/developer-platform";
import type { LeaseKeyResolver } from "@/lib/v2/leases";

export interface V2PlatformBindings { signer: AuditSigner; keyResolver: LeaseKeyResolver; oauthVerifier?: DeveloperAccessTokenVerifier; federation?: { keyWrapper: KeyWrapper; issuer: string } }
// Next instrumentation and route handlers may load separate copies of this module.
// Keep the injected provider process-local, shared across those bundles, never on disk.
const bindingKey = Symbol.for("relay.v2.platform-bindings");
const processState = globalThis as typeof globalThis & { [bindingKey]?: V2PlatformBindings };
export function configureV2PlatformBindings(value: V2PlatformBindings) { processState[bindingKey] = value; }
export function requireV2PlatformBindings() { const bindings = processState[bindingKey]; if (!bindings) throw new RelayError("CONNECTION_REQUIRED", "Relay V2 cryptographic platform bindings are not configured.", undefined, 503); return bindings; }
