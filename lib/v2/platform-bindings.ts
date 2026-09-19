import { RelayError } from "@/lib/errors";
import type { AuditSigner, KeyWrapper } from "@/lib/v2/evidence/crypto";
import type { DeveloperAccessTokenVerifier } from "@/lib/v2/developer-platform";
import type { LeaseKeyResolver } from "@/lib/v2/leases";

export interface V2PlatformBindings { signer: AuditSigner; keyResolver: LeaseKeyResolver; oauthVerifier?: DeveloperAccessTokenVerifier; federation?: { keyWrapper: KeyWrapper; issuer: string } }
let bindings: V2PlatformBindings | undefined;
export function configureV2PlatformBindings(value: V2PlatformBindings) { bindings = value; }
export function requireV2PlatformBindings() { if (!bindings) throw new RelayError("CONNECTION_REQUIRED", "Relay V2 cryptographic platform bindings are not configured.", undefined, 503); return bindings; }
